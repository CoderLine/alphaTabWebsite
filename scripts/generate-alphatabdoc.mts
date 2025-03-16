import path from "path";
import url from "url";
import fs, { link } from "fs";
import ts, { JSDocParsingMode } from "typescript";
import { getTypeWithNullableInfo } from "./typeschema";
import { toPascalCase } from "@site/src/names";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const alphaTabEntryFile = url.fileURLToPath(
  import.meta.resolve("@coderline/alphatab")
);
const alphaTabDir = path.resolve(alphaTabEntryFile, "..", "..");

const dts = path.resolve(alphaTabDir, "dist", "alphaTab.d.ts");
const host = ts.createCompilerHost({}, true);
host.jsDocParsingMode = JSDocParsingMode.ParseAll;

const program = ts.createProgram({
  rootNames: [dts],
  options: {},
  host: host,
});
const checker = program.getTypeChecker();

const ast = program.getSourceFile(dts);

const lookup = new Map<string, ts.DeclarationStatement>();

const outDir = path.resolve(__dirname, "..", "src", "alphatabdoc");

async function writeType(exportedName: string, schema: any) {
  const parts = exportedName.replace("alphaTab.", "").split(".");
  parts[parts.length - 1] = parts[parts.length - 1] + ".ts";

  const full = path.resolve(outDir, ...parts);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });

  console.log("writing", full);
  try {
    await fs.promises.writeFile(
      full,
      `export default ${JSON.stringify(schema, null, 2)};`
    );
  } catch (e) {
    console.error("error writing", full, e, schema);
  }
}

function jsDocSchema(d: ts.Node) {
  const comments = ts.getJSDocCommentsAndTags(d);

  const jsDoc = {
    doc: "",
    tags: {} as Record<string, string>,
  };

  if (comments.length > 0) {
    let i = 0;
    if (ts.isJSDoc(comments[0])) {
      jsDoc.doc = jsDocCommentToMarkdown(comments[0].comment);
      if (comments[0].tags) {
        for (const t of comments[0].tags) {
          jsDoc.tags[t.tagName.text] = jsDocCommentToMarkdown(t.comment);
        }
      }
      i++;
    }

    for (; i < comments.length; i++) {
      const tag = comments[i];
      if (!ts.isJSDoc(tag)) {
        jsDoc.tags[tag.tagName.text] = jsDocCommentToMarkdown(tag.comment);
      }
    }
  }

  return jsDoc;
}

async function writeEnumDeclaration(
  d: ts.EnumDeclaration,
  exportedName: string
) {
  await writeType(exportedName, {
    name: exportedName,
    kind: "enum",
    tsdoc: jsDocSchema(d),
    members: d.members.map((m) => {
      return {
        name: m.name.getText(),
        kind: "enummember",
        tsdoc: jsDocSchema(m),
      };
    }),
  });
}

function mapMemberSchema(
  parent: ts.ClassDeclaration,
  e: ts.ClassElement
): object | undefined {
  if (
    !e ||
    (ts.canHaveModifiers(e) &&
      e.modifiers?.some((m) => m.kind == ts.SyntaxKind.PrivateKeyword))
  ) {
    return undefined;
  }

  let type: string;
  const checker = program.getTypeChecker();
  let isStatic =
    ts.canHaveModifiers(e) &&
    e.modifiers?.some((m) => m.kind == ts.SyntaxKind.StaticKeyword);

  switch (e.kind) {
    case ts.SyntaxKind.MethodDeclaration:
      return {
        name: e.name!.getText(),
        kind: "method",
        tsdoc: jsDocSchema(e),
        static: isStatic,
        returnType: (e as ts.MethodDeclaration).type!.getText(),
        parameters: (e as ts.MethodDeclaration).parameters.map((p) => {
          return {
            name: p.name!.getText(),
            kind: "parameter",
            type: p.type!.getText(),
            optional: !!p.questionToken,
            defaultValue: p.initializer?.getText(),
          };
        }),
      };
    case ts.SyntaxKind.PropertyDeclaration:
      type = checker.typeToString(
        program.getTypeChecker().getTypeAtLocation(e)
      );
      return {
        name: e.name!.getText(),
        kind: "property",
        type: type,
        static: isStatic,
        readonly: (e as ts.PropertyDeclaration).modifiers?.some(
          (m) => m.kind == ts.SyntaxKind.ReadonlyKeyword
        ),
        tsdoc: jsDocSchema(e),
      };
    case ts.SyntaxKind.GetAccessor:
      type = checker.typeToString(
        program.getTypeChecker().getTypeAtLocation(e)
      );
      return {
        name: e.name!.getText(),
        kind: "property",
        type: type,
        static: isStatic,
        readonly: !parent.members.some(
          (s) =>
            s.kind === ts.SyntaxKind.SetAccessor &&
            s.name?.getText() === e.name?.getText()
        ),
        tsdoc: jsDocSchema(e),
      };
  }
  return undefined;
}

async function writeClassDeclaration(
  d: ts.ClassDeclaration,
  exportedName: string
) {
  await writeType(exportedName, {
    name: exportedName,
    kind: "class",
    tsdoc: jsDocSchema(d),
    members: d.members.map((m) => mapMemberSchema(d, m)).filter((m) => !!m),
  });
}

async function writeInterfaceDeclaration(
  d: ts.InterfaceDeclaration,
  exportedName: string
) {
  await writeType(exportedName, {
    name: exportedName,
    kind: "interface",
    tsdoc: jsDocSchema(d),
  });
}

function walkModuleDeclaration(
  d: ts.ModuleDeclaration,
  exportedName: string,
  handler: (
    exportName: string,
    internalName: string,
    d: ts.DeclarationStatement
  ) => void
) {
  if (!d.body || !ts.isModuleBlock(d.body)) {
    console.warn("Unsupported module declaration", exportedName);
    return;
  }

  for (const s of d.body.statements) {
    if (
      ts.isExportDeclaration(s) &&
      s.exportClause &&
      ts.isNamedExports(s.exportClause)
    ) {
      for (const nested of s.exportClause.elements) {
        let exportName = "";
        let typeName = "";
        if (nested.propertyName) {
          typeName = (nested.propertyName as ts.Identifier).text;
          exportName = (nested.name as ts.Identifier).text;
        } else {
          typeName = (nested.name as ts.Identifier).text;
          exportName = typeName;
        }

        if (lookup.has(typeName)) {
          walkExports(
            lookup.get(typeName)!,
            exportedName + "." + exportName,
            typeName,
            handler
          );
        } else {
          console.warn("Unresolved export", typeName, "in", exportedName);
        }
      }
    } else {
      console.warn(
        "Unsupported statement",
        ts.SyntaxKind[s.kind],
        "in",
        exportedName
      );
    }
  }
}

async function walkExports(
  d: ts.DeclarationStatement,
  exportName: string,
  internalName: string,
  handler: (
    exportName: string,
    internalName: string,
    d: ts.DeclarationStatement
  ) => void
) {
  if (!d.name || !ts.isIdentifier(d.name)) {
    return;
  }

  if (ts.isModuleDeclaration(d)) {
    walkModuleDeclaration(d, exportName, handler);
  } else {
    handler(exportName, internalName, d);
  }
}

const exports: { d: ts.DeclarationStatement; identifier: string }[] = [];
for (const d of ast!.statements) {
  if (!ts.isDeclarationStatement(d) || !ts.canHaveModifiers(d)) {
    continue;
  }
  const isExported = !!d.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );

  let identifier = "";
  if (d.name) {
    if (ts.isIdentifier(d.name)) {
      identifier = d.name.text;
    }
  }

  if (identifier) {
    lookup.set(identifier, d);
  }

  if (isExported) {
    exports.push({ d, identifier });
  }
}

const nameToExportName = new Map<string, string>();
const flatExports = new Map<string, ts.DeclarationStatement>();
for (const { d, identifier } of exports) {
  walkExports(d, "alphaTab." + identifier, identifier, async (e, i, d) => {
    if (
      ts.isEnumDeclaration(d) ||
      ts.isClassDeclaration(d) ||
      ts.isInterfaceDeclaration(d)
    ) {
      flatExports.set(e, d);
      nameToExportName.set(i, e);
    }
  });
}

const settings = flatExports.get("alphaTab.Settings") as ts.ClassDeclaration;

// create typescript modules with metadata exported
for (const [identifier, d] of flatExports.entries()) {
  if (ts.isEnumDeclaration(d)) {
    await writeEnumDeclaration(d, identifier);
  } else if (ts.isClassDeclaration(d)) {
    await writeClassDeclaration(d, identifier);
  } else if (ts.isInterfaceDeclaration(d)) {
    await writeInterfaceDeclaration(d, identifier);
  }
}

// Write settings  mdx
for (const m of settings.members) {
  const isStatic =
    ts.canHaveModifiers(m) &&
    m.modifiers?.some((mod) => mod.kind == ts.SyntaxKind.StaticKeyword);

  if (ts.isPropertyDeclaration(m) && !isStatic) {
    const basePath = path.join(
      __dirname,
      "..",
      "docs",
      "reference",
      "settings",
      m.name.getText().toLowerCase()
    );

    const subSettingType = checker.getTypeAtLocation(m).symbol.valueDeclaration;
    if (subSettingType && ts.isClassDeclaration(subSettingType)) {
      for (const subSettingProp of subSettingType.members) {
        const isSubSettingPropStatic =
          ts.canHaveModifiers(subSettingProp) &&
          subSettingProp.modifiers?.some(
            (mod) => mod.kind == ts.SyntaxKind.StaticKeyword
          );

        if (
          ts.isPropertyDeclaration(subSettingProp) &&
          !isSubSettingPropStatic
        ) {
          const settingFile = path.join(
            basePath,
            subSettingProp.name.getText().toLowerCase() + ".mdx"
          );

          await fs.promises.mkdir(basePath, { recursive: true });

          const fileStream = fs.createWriteStream(settingFile, {
            flags: "w",
          });
          try {
            fileStream.write("---\n");
            fileStream.write(
              `title: ${m.name.getText()}.${subSettingProp.name.getText()}\n`
            );

            fileStream.write(
              `description: ${getSummary(subSettingProp, false)}\n`
            );
            fileStream.write(`sidebar_custom_props:\n`);

            if (isTargetWeb(subSettingProp)) {
              fileStream.write(`  javaScriptOnly: true\n`);
            }

            if (isDomWildcard(subSettingProp)) {
              fileStream.write(`  domWildcard: true\n`);
            }

            if (isJsonOnParent(m)) {
              fileStream.write(`  jsOnParent: true\n`);
            }

            fileStream.write(
              `  category: ${getJsDocTagText(subSettingProp, "category")}\n`
            );

            const since = getJsDocTagText(subSettingProp, "since");
            fileStream.write(`  since: ${since}\n`);

            fileStream.write("---\n");

            fileStream.write(
              "import { SinceBadge } from '@site/src/components/SinceBadge';\n"
            );
            fileStream.write("\n");
            fileStream.write(`<SinceBadge since=${JSON.stringify(since)} />\n`);
            fileStream.write(`\n`);
            fileStream.write(
              `import { PropertyDescription } from '@site/src/components/PropertyDescription';\n`
            );
            fileStream.write(
              `import {TypeTable, TypeRow} from '@site/src/components/TypeTable';\n`
            );

            // fileStream.write(`## Summary\n`);
            // fileStream.write(`${summary}\n\n`);

            const remarks = getJsDocTagText(subSettingProp, "remarks");
            fileStream.write(`\n## Description\n`);
            if (remarks) {
              fileStream.write(`${remarks}\n\n`);
            } else {
              fileStream.write(`${getSummary(subSettingProp, true)}\n\n`);
            }

            fileStream.write(`<PropertyDescription showJson={true} />\n`);

            const importFile = path.join(
              basePath,
              "_" + subSettingProp.name.getText().toLowerCase() + ".mdx"
            );

            try {
              await fs.promises.access(importFile, fs.constants.R_OK);

              fileStream.write(
                `\nimport ManualDocs from './_${subSettingProp.name
                  .getText()
                  .toLowerCase()}.mdx';\n`
              );
              fileStream.write("\n");
              fileStream.write(`<ManualDocs />\n`);
            } catch (e) {
              // ignore
            }

            fileStream.write(`\n## Types\n\n`);
            fileStream.write(
              `${typeToMarkdown(
                program.getTypeChecker().getTypeAtLocation(subSettingProp),
                subSettingProp,
                !!subSettingProp.questionToken
              )}\n`
            );

            const defaultValue = getJsDocTagText(
              subSettingProp,
              "defaultValue"
            );
            if (defaultValue) {
              fileStream.write(`\n## Default Value\n\n`);
              fileStream.write(`${defaultValue}\n`);
            }

            const examples = collectExamples(subSettingProp);
            if (examples.length === 1) {
              fileStream.write(`\n## Example - ${examples[0].title}\n\n`);
              fileStream.write(`${examples[0].markdown}\n`);
            } else if (examples.length > 1) {
              fileStream.write(`\n## Examples\n\n`);
              fileStream.write('import ExampleTabs from "@theme/Tabs";\n');
              fileStream.write(
                'import ExampleTabItem from "@theme/TabItem";\n\n'
              );
              fileStream.write("<ExampleTabs");
              fileStream.write(
                `    defaultValue=${JSON.stringify(examples[0].key)}\n`
              );
              fileStream.write(`    values={[\n`);

              for (let i = 0; i < examples.length; i++) {
                fileStream.write(
                  `      { label: ${JSON.stringify(
                    examples[i].title
                  )}, value: ${JSON.stringify(examples[i].key)}}`
                );
                if (i < examples.length - 1) {
                  fileStream.write(`,\n`);
                } else {
                  fileStream.write(`\n`);
                }
              }

              fileStream.write(`    ]}\n`);
              fileStream.write(`>\n`);

              for (const example of examples) {
                fileStream.write(
                  `<ExampleTabItem value=${JSON.stringify(example.key)}>\n`
                );

                fileStream.write(`${example.markdown}\n`);

                fileStream.write(`</ExampleTabItem>\n`);
              }

              fileStream.write(`</ExampleTabs>\n`);
            }
          } finally {
            fileStream.end();
          }
        }
      }
    }
  }
}

function toExampleKey(title: string) {
  return title
    .toLowerCase()
    .replaceAll("#", "sharp")
    .replaceAll(/[^a-z0-9]/g, "-");
}

function collectExamples(
  node: ts.Node
): { key: string; title: string; markdown: string }[] {
  const examples: { key: string; title: string; markdown: string }[] = [];

  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text === "example") {
      const [title, ...markdown] = jsDocCommentToMarkdown(tag.comment).split(
        "\n"
      );
      examples.push({
        key: toExampleKey(title.trim()),
        title: title.trim(),
        markdown: markdown.join("\n").trim(),
      });
    }
  }

  return examples;
}

function isJsonOnParent(node: ts.Node): boolean {
  return !!ts
    .getJSDocTags(node)
    .find((t) => t.tagName.text === "json_on_parent");
}

function isTargetWeb(node: ts.Node): boolean {
  return !!ts
    .getJSDocTags(node)
    .find((t) => t.tagName.text === "target" && t.comment === "web");
}

function isDomWildcard(node: ts.Node): boolean {
  return !!ts.getJSDocTags(node).find((t) => t.tagName.text === "domWildcard");
}

function getJsDocTagText(node: ts.Node, tagName: string): string {
  return jsDocCommentToMarkdown(
    ts.getJSDocTags(node).find((t) => t.tagName.text === tagName)?.comment
  );
}

function getSummary(node: ts.Node, resolveLinks: boolean): string {
  const jsDoc = ts.getJSDocCommentsAndTags(node);
  if (jsDoc.length > 0 && ts.isJSDoc(jsDoc[0])) {
    return (
      jsDocCommentToMarkdown(jsDoc[0].comment, resolveLinks)
        .split("\n")
        .find((l) => l.trim().length > 0) ?? ""
    );
  }

  return "";
}

function rewriteJsDocText(s: string): string {
  return s
    .replaceAll("https://alphatab.net/", "/")
    .replaceAll("https://www.alphatab.net/", "/")
    .replaceAll(/\{@since ([^}]+)\}/g, (_, since) => {
      return `<SinceBadge inline={true} since={${JSON.stringify(since)}} />`;
    });
}

function jsDocCommentToMarkdown(
  comment: ts.JSDoc["comment"] | ts.JSDocComment,
  resolveLinks: boolean = true
) {
  if (comment !== undefined) {
    let text = "";

    if (typeof comment === "string") {
      text += rewriteJsDocText(comment);
    } else if ("kind" in comment) {
      switch (comment.kind) {
        case ts.SyntaxKind.JSDocText:
          text += rewriteJsDocText(comment.text);
          break;
        case ts.SyntaxKind.JSDocLink:
        case ts.SyntaxKind.JSDocLinkCode:
        case ts.SyntaxKind.JSDocLinkPlain:
          let linkText = comment.text;
          let linkUrl = "";
          if (comment.name) {
            if (!linkText) {
              linkText = "`" + comment.name.getText() + "`";
            }
            if (resolveLinks) {
              // workaround for https://github.com/microsoft/TypeScript/issues/61433
              let symbol: ts.Symbol | undefined;
              if (comment.name.getText().endsWith(".name")) {
                // resolve parent
                if (ts.isQualifiedName(comment.name)) {
                  symbol = checker.getSymbolAtLocation(comment.name.left);
                } else if (ts.isJSDocMemberName(comment.name)) {
                  symbol = checker.getSymbolAtLocation(comment.name.left);
                }

                symbol = symbol?.members?.get(
                  ts.escapeLeadingUnderscores("name")
                );
              } else {
                symbol = checker.getSymbolAtLocation(comment.name);
              }

              if (symbol) {
                linkUrl =
                  tryGetSettingsLink(symbol, comment.name) ??
                  tryGetReferenceLink(symbol, comment.name);
              } else {
                console.error(
                  `Could not resolve tsdoc link ${comment.name.getText()} at `,
                  comment
                    .getSourceFile()
                    .getLineAndCharacterOfPosition(comment.pos)
                );
              }
            }
          }

          if (linkUrl) {
            text += `[${linkText}](${linkUrl})`;
          } else {
            text += linkText;
          }

          break;
      }
    } else {
      for (const n of comment) {
        text += jsDocCommentToMarkdown(n, resolveLinks);
      }
    }

    return text;
  }
  return "";
}

function tryGetSettingsLink(
  symbol: ts.Symbol,
  node: ts.Node
): string | undefined {
  if ("parent" in symbol && symbol.parent) {
    const parentSymbol = symbol.parent as ts.Symbol;
    if (parentSymbol.name.endsWith("Settings")) {
      const settingsProp = settings.members.find(
        (m) =>
          ts.isPropertyDeclaration(m) &&
          m.type &&
          checker.getTypeAtLocation(m.type).symbol == symbol.parent
      );
      if (settingsProp) {
        return `/docs/reference/settings/${settingsProp
          .name!.getText()
          .toLowerCase()}/${symbol.name.toLowerCase()}`;
      } else {
        console.warn(
          "Could not find a property of type ",
          parentSymbol.name,
          " in Settings"
        );
        return undefined;
      }
    }

    return undefined;
  } else {
    // console.warn("Symbol", symbol.name, " has no parent symbol",
    //   node.getSourceFile().fileName,
    //   node.getSourceFile().getLineAndCharacterOfPosition(node.pos),

    // );
    return undefined;
  }
}

function valueOrFirstDeclarationInDts(
  s: ts.Symbol,
  referenceNode: ts.Node,
  throwError: boolean
) {
  if (s.valueDeclaration) {
    return s.valueDeclaration;
  }

  const d = s.declarations?.find(
    (d) => path.basename(d.getSourceFile().fileName) == path.basename(dts)
  );
  if (d) {
    return d;
  }

  if (throwError) {
    throw new Error(
      "Could not resolve declarataion of symbol " +
        s.name +
        " at " +
        referenceNode.getSourceFile().fileName +
        ":" +
        referenceNode
          .getSourceFile()
          .getLineAndCharacterOfPosition(referenceNode.pos)
    );
  }

  return undefined;
}

function tryGetReferenceLink(
  symbolOrNode: ts.Symbol | ts.Node,
  referenceNode: ts.Node
): string {
  if ("kind" in symbolOrNode) {
    if (
      path.basename(symbolOrNode.getSourceFile().fileName) !==
      path.basename(dts)
    ) {
      return "";
    }

    switch (symbolOrNode.kind) {
      case ts.SyntaxKind.ClassDeclaration:
      case ts.SyntaxKind.EnumDeclaration:
      case ts.SyntaxKind.InterfaceDeclaration:
        return `/docs/reference/plain/${(
          symbolOrNode as ts.DeclarationStatement
        )
          .name!.getText()
          .toLowerCase()}.mdx`;

      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.MethodSignature:
      case ts.SyntaxKind.Constructor:
      case ts.SyntaxKind.GetAccessor:
      case ts.SyntaxKind.SetAccessor:
      case ts.SyntaxKind.PropertyDeclaration:
      case ts.SyntaxKind.EnumMember:
        return (
          tryGetReferenceLink(symbolOrNode.parent, referenceNode) +
          "#" +
          (symbolOrNode as ts.ClassElement).name!.getText().toLowerCase()
        );
      default:
        console.error(
          "Unhandled node kind",
          ts.SyntaxKind[symbolOrNode.kind],
          "at",
          symbolOrNode.getSourceFile().fileName,
          symbolOrNode
            .getSourceFile()
            .getLineAndCharacterOfPosition(symbolOrNode.pos)
        );
    }
  } else {
    let declaration = valueOrFirstDeclarationInDts(
      symbolOrNode,
      referenceNode,
      false
    );
    if (declaration) {
      return tryGetReferenceLink(declaration, referenceNode);
    }

    const type = checker.getDeclaredTypeOfSymbol(symbolOrNode);
    declaration = valueOrFirstDeclarationInDts(
      type.symbol,
      referenceNode,
      true
    );
    return tryGetReferenceLink(declaration!, referenceNode);
  }

  return "";
}

function typeToMarkdown(
  type: ts.Type,
  node: ts.Node,
  isOptionalFromDeclaration: boolean
): string {
  const typeInfo = getTypeWithNullableInfo(
    program,
    type,
    true,
    isOptionalFromDeclaration,
    undefined
  );
  let typeString = checker.typeToString(type);

  if (typeInfo.isOwnType) {
    const linkUrl =
      tryGetSettingsLink(type.symbol, node) ??
      tryGetReferenceLink(type.symbol, node);
    if (nameToExportName.has(typeString)) {
      typeString = nameToExportName.get(typeString)!;
    }

    const lines: string[] = [
      "<TypeTable>",
      `    <TypeRow name={${JSON.stringify(typeString)}} url={${JSON.stringify(
        linkUrl
      )}}/>`,
      "</TypeTable>",
    ];

    const exportedType = nameToExportName.get(typeInfo.typeAsString);

    if (typeInfo.isEnumType && exportedType && flatExports.has(exportedType)) {
      const enumDeclaration = flatExports.get(
        exportedType
      ) as ts.EnumDeclaration;
      lines.push(
        "",
        `### ${typeString}`,
        "<TypeTable>",
        `  <TypeRow type="js" name=${JSON.stringify(exportedType)}>`,
        ...enumDeclaration.members.map(
          (member, i, a) =>
            `    \`${member.name.getText()}\` - ${getSummary(member, true)}${
              i < a.length - 1 ? "<br />" : ""
            }`
        ),
        `  </TypeRow>`,

        `  <TypeRow type="json-js-html" name="string">`,
        ...enumDeclaration.members.map(
          (member, i, a) =>
            `    \`${member.name.getText().toLowerCase()}\`${
              i < a.length - 1 ? "<br />" : ""
            }`
        ),
        `  </TypeRow>`,

        `  <TypeRow type="json-js-html" name="int">`,
        ...enumDeclaration.members.map(
          (member, i, a) =>
            `    \`${getEnumValue(member)}\` - ${member.name.getText()} ${i < a.length - 1 ? "<br />" : ""}`
        ),
        `  </TypeRow>`,

        `  <TypeRow type="net" name=${JSON.stringify(toPascalCase(exportedType))}>`,
        ...enumDeclaration.members.map(
          (member, i, a) =>
            `    \`${member.name.getText()}\`${
              i < a.length - 1 ? "<br />" : ""
            }`
        ),
        `  </TypeRow>`,

        `  <TypeRow type="android" name=${JSON.stringify(exportedType)}>`,
        ...enumDeclaration.members.map(
          (member, i, a) =>
            `    \`${member.name.getText()}\`${
              i < a.length - 1 ? "<br />" : ""
            }`
        ),
        `  </TypeRow>`,


        "</TypeTable>"
      );
    }

    return lines.join("\n");
  }

  // TODO: union types (e.g. nullable/optional)
  // TODO: primitives and array
  // TODO: C#/Kotlin types
  // TODO: Generics (e.g. maps)
  return [
    "<TypeTable>",
    `    <TypeRow name={${JSON.stringify(typeString)}} />`,
    "</TypeTable>",
  ].join("\n");
}

function getEnumValue(m: ts.EnumMember) {
  if (m.initializer) {
    return m.initializer.getText();
  }
  return checker.getConstantValue(m);
}
