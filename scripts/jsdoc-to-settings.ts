import ts from "typescript";
import url from "url";
import path from "path";
import fs from "fs";
import { EOL } from "node:os";
import { buildNames, toCamelCase, toPascalCase } from "@site/src/names";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

type Category = {
  type: string;
  settingsProperty: string;
  category: string;
  jsOnParent: boolean;
};

type JSDocText = ts.JSDoc["comment"];

type ParsedExample = {
  label: string;
  key: string;
  text: string;
};

type ParsedJSDoc = {
  text: JSDocText;
  summary?: JSDocText;
  default?: string;
  since?: string;
  webOnly: boolean;
  examples?: ParsedExample[];
};

function parseExample(text: JSDocText): ParsedExample {
  const markdown = jsDocToMarkdown(text);

  const firstLineEnd = markdown.indexOf("\n");
  if (firstLineEnd === -1) {
    return { label: "General", key: "general", text: markdown };
  }

  const marker = markdown.substring(0, firstLineEnd).trim();
  const code = markdown.substring(firstLineEnd + 1);
  switch (marker) {
    case "web":
      return { label: "JavaScript", key: marker, text: code };
    case "html":
      return { label: "HTML", key: marker, text: code };
    case "jquery":
      return { label: "jQuery", key: marker, text: code };
    case "net":
      return { label: "C#", key: marker, text: code };
    case "android":
      return { label: "Kotlin (Android)", key: marker, text: code };
    default:
      return { label: "General", key: "general", text: code };
  }
}

function parseJsDoc(doc: ts.JSDoc): ParsedJSDoc {
  const parsed: ParsedJSDoc = {
    text: "",
    webOnly: false,
  };

  if (doc.comment !== undefined) {
    parsed.text = doc.comment;
  }

  if (doc.tags) {
    for (const tag of doc.tags) {
      switch (tag.tagName.text) {
        case "summary":
          parsed.summary = tag.comment;
          break;
        case "default":
          parsed.default = tag.comment as string;
          break;
        case "since":
          parsed.since = tag.comment as string;
          break;
        case "target":
          if (tag.comment === "web") {
            parsed.webOnly = true;
          }
          break;
        case "example":
          if (tag.comment) {
            parsed.examples ??= [];
            parsed.examples.push(parseExample(tag.comment));
          }

          break;
      }
    }
  }

  return parsed;
}

function jsDocIdentifierToText(
  identifier: ts.JSDocMemberName | ts.EntityName
): string {
  switch (identifier.kind) {
    case ts.SyntaxKind.JSDocMemberName:
      return (
        jsDocIdentifierToText(identifier.left) +
        "." +
        jsDocIdentifierToText(identifier.right)
      );
    case ts.SyntaxKind.Identifier:
      return identifier.text;
    case ts.SyntaxKind.QualifiedName:
      return (
        jsDocIdentifierToText(identifier.left) +
        "." +
        jsDocIdentifierToText(identifier.right)
      );
  }
}

function transformRawJsDocText(str: string): string {
  str = str.replace(/\{@([^ \}]+)([^\}]+)\}/g, (match, tag, value) => {
    switch (tag) {
      case "since":
        return `<span class="badge badge--info">Since ${value}</span>`;
    }
    console.warn("Unknown JSDoc inline tag " + tag + " -> " + match);
    return "`" + match + "`";
  });


  
  str = str.replaceAll("https://alphatab.net/", "/");

  return str;
}

function jsDocToMarkdown(textOrNode?: JSDocText | ts.Node): string | undefined {
  if (textOrNode === undefined) {
    return undefined;
  }

  if (typeof textOrNode === "string") {
    return transformRawJsDocText(textOrNode);
  }

  if ("kind" in textOrNode) {
    const jsDoc = ts
      .getJSDocCommentsAndTags(textOrNode)
      .find((o) => ts.isJSDoc(o)) as ts.JSDoc;
    if (!jsDoc) {
      return undefined;
    }
    return jsDocToMarkdown(
      jsDoc.tags?.find((t) => t.tagName.text === "summary")?.comment ??
        jsDoc.comment
    );
  }

  let fullText = "";

  for (const t of textOrNode) {
    switch (t.kind) {
      case ts.SyntaxKind.JSDocText:
        fullText += transformRawJsDocText((t as ts.JSDocText).text);
        break;
      case ts.SyntaxKind.JSDocLink:
        const link = t as ts.JSDocLink;
        if (link.name) {
          fullText += "`" + jsDocIdentifierToText(link.name) + "`";
        } else {
          fullText += "`" + link.text + "`";
        }
        break;
      case ts.SyntaxKind.JSDocLinkCode:
        break;
      case ts.SyntaxKind.JSDocLinkPlain:
        break;
    }
  }

  return fullText;
}

function generateSettingsPageFrontMatter(
  category: Category,
  prop: ts.PropertyDeclaration,
  doc: ParsedJSDoc
): string[] {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`title: ${category.settingsProperty}.${prop.name.getText()}`);

  const description =
    jsDocToMarkdown(doc.summary) ??
    jsDocToMarkdown(doc.text)?.split("\n")[0] ??
    "";
  if (description) {
    lines.push(`description: ${description}`);
  }

  lines.push("sidebar_custom_props:");

  if (doc.webOnly) {
    lines.push("  javaScriptOnly: true");
  }

  if (category.jsOnParent) {
    lines.push("  jsOnParent: true");
  }

  let categoryTitle = category.category;
  if (doc.webOnly) {
    categoryTitle += " - JavaScript Specific";
  }
  lines.push(`  category: ${categoryTitle}`);

  if (doc.since) {
    lines.push(`  since: ${doc.since}`);
  }

  lines.push("---");

  return lines;
}

function generateSettingsPageDescription(
  category: Category,
  prop: ts.PropertyDeclaration,
  doc: ParsedJSDoc
): string[] {
  const lines: string[] = [];

  lines.push("import Tabs from '@theme/Tabs';");
  lines.push("import TabItem from '@theme/TabItem';");
  lines.push(`import { SinceBadge } from '@site/src/components/SinceBadge';`);
  lines.push(`import { CodeBadge } from '@site/src/components/CodeBadge';`);
  lines.push(
    `import { PropertyDescription } from '@site/src/components/PropertyDescription';`
  );
  lines.push(
    `import { TypeTable, TypeRow } from '@site/src/components/TypeTable';`
  );
  lines.push("");

  if (doc.since) {
    lines.push(`<SinceBadge since="${doc.since}" />`);
    lines.push("");
  }

  lines.push(
    '<table className="table table-striped table-condensed type-table">'
  );
  lines.push("    <thead>");
  lines.push("        <tr>");
  lines.push("          <th>Name</th>");
  lines.push("          <th>Type</th>");
  lines.push("          <th>Default</th>");
  lines.push("        </tr>");
  lines.push("    </thead>");
  lines.push("    <tbody>");

  const jsName = prop.name.getText();
  const jsType = prop.type.getText();

  const jsDefaultValue = `<code>${doc.default ?? ''}</code>`;
  const doubleQuoteDefaultValue = `<code>${doc.default?.replaceAll("'", '"') ?? ''}</code>`;

  lines.push("        <tr>");
  lines.push(
    `          <td><CodeBadge type="js" name=${JSON.stringify(
      category.settingsProperty + "." + jsName
    )} /></td>`
  );
  lines.push(
    `          <td><CodeBadge type="js" name=${JSON.stringify(jsType)} /></td>`
  );
  lines.push(`          <td>${jsDefaultValue}</td>`);
  lines.push("        </tr>");

  if (category.jsOnParent) {
    lines.push("        <tr>");
    lines.push(
      `          <td><CodeBadge type="js" name=${JSON.stringify(
        jsName
      )} /></td>`
    );
    lines.push(
      `          <td><CodeBadge type="js" name=${JSON.stringify(
        jsType
      )} /></td>`
    );
    lines.push(`          <td>${jsDefaultValue}</td>`);
    lines.push("        </tr>");
  }

  lines.push("        <tr>");
  lines.push(
    `          <td><CodeBadge type="json" name=${JSON.stringify(
      category.settingsProperty + "." + jsName
    )} /></td>`
  );
  lines.push(
    `          <td><CodeBadge type="json" name=${JSON.stringify(
      jsType
    )} /></td>`
  );
  lines.push(`          <td>${doubleQuoteDefaultValue}</td>`);
  lines.push("        </tr>");

  if (category.jsOnParent) {
    lines.push("        <tr>");
    lines.push(
      `          <td><CodeBadge type="json" name=${JSON.stringify(
        jsName
      )} /></td>`
    );
    lines.push(
      `          <td><CodeBadge type="json" name=${JSON.stringify(
        jsType
      )} /></td>`
    );
    lines.push(`          <td>${doubleQuoteDefaultValue}</td>`);
    lines.push("        </tr>");
  }

  if (!doc.webOnly) {
    lines.push("        <tr>");
    lines.push(
      `          <td><CodeBadge type="net" name=${JSON.stringify(
        toPascalCase(category.settingsProperty + "." + jsName)
      )} /></td>`
    );
    lines.push(
      `          <td><CodeBadge type="net" name=${JSON.stringify(
        translateToDotNetType(prop.type, prop.questionToken !== undefined)
      )} /></td>`
    );
    lines.push(`          <td>${doubleQuoteDefaultValue}</td>`);
    lines.push("        </tr>");

    lines.push("        <tr>");
    lines.push(
      `          <td><CodeBadge type="android" name=${JSON.stringify(
        toCamelCase(category.settingsProperty + "." + jsName)
      )} /></td>`
    );
    lines.push(
      `          <td><CodeBadge type="android" name=${JSON.stringify(
        translateToKotlinType(prop.type, prop.questionToken !== undefined)
      )} /></td>`
    );
    lines.push(`          <td>${doubleQuoteDefaultValue}</td>`);
    lines.push("        </tr>");
  }

  lines.push("    </tbody>");
  lines.push("</table>");
  lines.push("");

  lines.push("## Description");
  lines.push(jsDocToMarkdown(doc.text));
  lines.push("");

  return lines;
}

function translateToDotNetType(
  type: ts.TypeNode | ts.EntityName,
  propertyOptional: boolean
): string {
  if (propertyOptional) {
    return translateToDotNetType(type, false) + "?";
  }

  if (ts.isIdentifier(type)) {
    return toPascalCase(type.text);
  } else if (ts.isQualifiedName(type)) {
    return (
      translateToDotNetType(type.left, false) +
      "." +
      translateToDotNetType(type.right, false)
    );
  } else if (ts.isTypeReferenceNode(type)) {
    const name = translateToDotNetType(type.typeName, false);
    if (!type.typeArguments || type.typeArguments.length === 0) {
      return name;
    }

    return (
      name +
      "<" +
      type.typeArguments
        .map((a) => translateToDotNetType(a, false))
        .join(", ") +
      ">"
    );
  } else if (ts.isArrayTypeNode(type)) {
    return `IList<${translateToDotNetType(type.elementType, false)}>`;
  } else {
    switch (type.kind) {
      case ts.SyntaxKind.NumberKeyword:
        return "double";
      case ts.SyntaxKind.StringKeyword:
        return "string";
      case ts.SyntaxKind.BooleanKeyword:
        return "bool";
      default:
        throw new Error(
          `Type node ${
            ts.SyntaxKind[type.kind]
          } is unsupproted for translation, extend doc generator`
        );
    }
  }
}

function translateToKotlinType(type: ts.TypeNode, propertyOptional: boolean) {
  if (propertyOptional) {
    return translateToDotNetType(type, false) + "?";
  }

  if (ts.isIdentifier(type)) {
    return toPascalCase(type.text);
  } else if (ts.isQualifiedName(type)) {
    return (
      translateToDotNetType(type.left, false) +
      "." +
      translateToDotNetType(type.right, false)
    );
  } else if (ts.isTypeReferenceNode(type)) {
    const name = translateToDotNetType(type.typeName, false);
    if (!type.typeArguments || type.typeArguments.length === 0) {
      return name;
    }

    return (
      name +
      "<" +
      type.typeArguments
        .map((a) => translateToDotNetType(a, false))
        .join(", ") +
      ">"
    );
  } else if (ts.isArrayTypeNode(type)) {
    const elementType = translateToDotNetType(type.elementType, false);

    if (elementType === "Boolean") {
      return "alphaTab.collections.BooleanList";
    } else if (elementType === "Double") {
      return "alphaTab.collections.DoubleList";
    } else {
      return "alphaTab.collections.List<" + elementType + ">";
    }
  } else {
    switch (type.kind) {
      case ts.SyntaxKind.NumberKeyword:
        return "Double";
      case ts.SyntaxKind.StringKeyword:
        return "String";
      case ts.SyntaxKind.BooleanKeyword:
        return "Boolean";
      default:
        throw new Error(
          `Type node ${
            ts.SyntaxKind[type.kind]
          } is unsupproted for translation, extend doc generator`
        );
        break;
    }
  }
}

function unwrapNullableType(type: ts.TypeNode): ts.TypeNode {
  if (ts.isUnionTypeNode(type)) {
    let wrappedType: ts.TypeNode | null = null;

    for (const t of type.types) {
      // nullable markers
      if (
        t.kind === ts.SyntaxKind.NullKeyword ||
        t.kind === ts.SyntaxKind.UndefinedKeyword
      ) {
        continue;
      } else {
        if (wrappedType == null) {
          wrappedType = t;
        } else {
          return type; // real union type, return as is
        }
      }
    }

    return wrappedType;
  }

  return type;
}

function generateTypeDocs(
  ctx: SettingsGenContext,
  type: ts.TypeNode | undefined
): string[] {
  const lines: string[] = [];

  if (type) {
    const notNullable = unwrapNullableType(type);

    if (ts.isTypeReferenceNode(notNullable)) {
      const identifier = jsDocIdentifierToText(notNullable.typeName);
      const referencedType = ctx.declarations.get(identifier);

      const displayName = ctx.exportNameLookup.get(identifier) ?? identifier;

      if (referencedType) {
        switch (referencedType.kind) {
          case ts.SyntaxKind.EnumDeclaration:
            const enumMembers = (referencedType as ts.EnumDeclaration).members;
            const docs = new Map<string, string>(
              enumMembers.map((m) => [m.name.getText(), jsDocToMarkdown(m)])
            );

            lines.push(`### \`enum ${displayName}\``);
            lines.push("");

            lines.push(`<Tabs defaultValue="js" values={[`);
            lines.push(`  { label: "JavaScript", value: "js" },`);
            lines.push(`  { label: "Json", value: "json" },`);
            lines.push(`  { label: "C#", value: "net" },`);
            lines.push(`  { label: "Kotlin (Android)", value: "kotlin" },`);
            lines.push(`]}>`);

            lines.push(`<TabItem value="js">`);

            lines.push(`\`import * as alphaTab from '@coderline/alphaTab';\``);
            lines.push(``);

            for (const enumValue of enumMembers) {
              lines.push(
                `* \`${displayName}.${enumValue.name.getText()}\` - ${docs.get(
                  enumValue.name.getText()
                )}`
              );
            }

            lines.push(`</TabItem>`);

            lines.push(`<TabItem value="json">`);

            for (const enumValue of enumMembers) {
              lines.push(
                `* \`"${enumValue.name.getText()}"\` - ${docs.get(
                  enumValue.name.getText()
                )}`
              );
            }

            lines.push(`</TabItem>`);

            lines.push(`<TabItem value="net">`);

            for (const enumValue of enumMembers) {
              lines.push(
                `* \`${toPascalCase(
                  displayName + "." + enumValue.name.getText()
                )}\` - ${docs.get(enumValue.name.getText())}`
              );
            }

            lines.push(`</TabItem>`);

            lines.push(`<TabItem value="kotlin">`);

            for (const enumValue of enumMembers) {
              lines.push(
                `* \`${toCamelCase(
                  displayName + "." + enumValue.name.getText()
                )}\` - ${docs.get(enumValue.name.getText())}`
              );
            }

            lines.push(`</TabItem>`);

            lines.push("</Tabs>");

            break;

          case ts.SyntaxKind.ClassDeclaration:
            const clz = referencedType as ts.ClassDeclaration;

            lines.push(`### \`class ${displayName}\``);
            lines.push("");

            lines.push(`<Tabs defaultValue="js" values={[`);
            lines.push(`  { label: "JavaScript", value: "js" },`);
            lines.push(`  { label: "Json", value: "json" },`);
            lines.push(`  { label: "C#", value: "net" },`);
            lines.push(`  { label: "Kotlin (Android)", value: "kotlin" },`);
            lines.push(`]}>`);

            lines.push(`<TabItem value="js">`);
            lines.push(
              `<table className="table table-striped table-condensed type-table">`
            );
            lines.push(`    <thead>`);
            lines.push(`        <tr>`);
            lines.push(`            <th>Property</th>`);
            lines.push(`            <th>Type</th>`);
            lines.push(`            <th>Default</th>`);
            lines.push(`            <th>Summary</th>`);
            lines.push(`        </tr>`);
            lines.push(`    </thead>    `);
            lines.push(`    <tbody> `);

            for (const prop of clz.members.filter(isMemberProperty)) {
              lines.push(`        <tr>`);
              lines.push(
                `            <td><CodeBadge type="js" name="${prop.name.getText()}" /></td>`
              );
              lines.push(
                `            <td><code>${prop.type.getText()}</code></td>`
              );
              lines.push(
                `            <td><code>${getDefaultValue(prop)}</code></td>`
              );
              lines.push(`            <td>${jsDocToMarkdown(prop)}</td>`);
              lines.push(`        </tr>`);
            }

            lines.push(`    </tbody>`);
            lines.push(`</table>`);
            lines.push(`</TabItem>`);

            lines.push(`<TabItem value="json">`);
            lines.push(
              `<table className="table table-striped table-condensed type-table">`
            );
            lines.push(`    <thead>`);
            lines.push(`        <tr>`);
            lines.push(`            <th>Setting</th>`);
            lines.push(`            <th>Type</th>`);
            lines.push(`            <th>Default</th>`);
            lines.push(`            <th>Summary</th>`);
            lines.push(`        </tr>`);
            lines.push(`    </thead>    `);
            lines.push(`    <tbody> `);

            for (const prop of clz.members.filter(isMemberProperty)) {
              lines.push(`        <tr>`);
              lines.push(
                `            <td><CodeBadge type="json" name="${prop.name.getText()}" /></td>`
              );
              lines.push(
                `            <td><code>${prop.type.getText()}</code></td>`
              );
              lines.push(
                `            <td><code>${getDefaultValue(prop)}</code></td>`
              );
              lines.push(`            <td>${jsDocToMarkdown(prop)}</td>`);
              lines.push(`        </tr>`);
            }

            lines.push(`    </tbody>`);
            lines.push(`</table>`);
            lines.push(`</TabItem>`);

            lines.push(`<TabItem value="net">`);
            lines.push(
              `<table className="table table-striped table-condensed type-table">`
            );
            lines.push(`    <thead>`);
            lines.push(`        <tr>`);
            lines.push(`            <th>Setting</th>`);
            lines.push(`            <th>Type</th>`);
            lines.push(`            <th>Default</th>`);
            lines.push(`            <th>Summary</th>`);
            lines.push(`        </tr>`);
            lines.push(`    </thead>    `);
            lines.push(`    <tbody> `);

            for (const prop of clz.members.filter(isMemberProperty)) {
              lines.push(`        <tr>`);
              lines.push(
                `            <td><CodeBadge type="net" name="${toPascalCase(
                  prop.name.getText()
                )}" /></td>`
              );
              lines.push(
                `            <td><code>${translateToDotNetType(
                  prop.type,
                  prop.questionToken !== undefined
                )}</code></td>`
              );
              lines.push(
                `            <td><code>${getDefaultValue(prop)}</code></td>`
              );
              lines.push(`            <td>${jsDocToMarkdown(prop)}</td>`);
              lines.push(`        </tr>`);
            }

            lines.push(`    </tbody>`);
            lines.push(`</table>`);
            lines.push(`</TabItem>`);

            lines.push(`<TabItem value="kotlin">`);
            lines.push(
              `<table className="table table-striped table-condensed type-table">`
            );
            lines.push(`    <thead>`);
            lines.push(`        <tr>`);
            lines.push(`            <th>Setting</th>`);
            lines.push(`            <th>Type</th>`);
            lines.push(`            <th>Default</th>`);
            lines.push(`            <th>Summary</th>`);
            lines.push(`        </tr>`);
            lines.push(`    </thead>    `);
            lines.push(`    <tbody> `);

            for (const prop of clz.members.filter(isMemberProperty)) {
              lines.push(`        <tr>`);
              lines.push(
                `            <td><CodeBadge type="net" name="${toCamelCase(
                  prop.name.getText()
                )}" /></td>`
              );
              lines.push(
                `            <td><code>${translateToKotlinType(
                  prop.type,
                  prop.questionToken !== undefined
                )}</code></td>`
              );
              lines.push(
                `            <td><code>${getDefaultValue(prop)}</code></td>`
              );
              lines.push(`            <td>${jsDocToMarkdown(prop)}</td>`);
              lines.push(`        </tr>`);
            }

            lines.push(`    </tbody>`);
            lines.push(`</table>`);
            lines.push(`</TabItem>`);

            lines.push("</Tabs>");
            break;
        }
      }
    }
  }

  return lines;
}

function generateSettingsPageTypes(
  ctx: SettingsGenContext,
  prop: ts.PropertyDeclaration,
  doc: ParsedJSDoc
): string[] {
  const lines: string[] = [];

  const typeDocs = generateTypeDocs(ctx, prop.type);

  if (typeDocs.length > 0) {
    lines.push("## Related Types");
    lines.push("");
    lines.push(...typeDocs);
  }

  return lines;
}

function generateSettingsPageExamples(doc: ParsedJSDoc): string[] {
  const lines: string[] = [];

  if (doc.examples && doc.examples.length > 0) {
    lines.push("## Examples");
    lines.push("");

    const defaultValue = doc.examples[0].key;
    const tabValues = doc.examples.map((e) => ({
      label: e.label,
      value: e.key,
    }));

    lines.push(
      `<Tabs defaultValue=${JSON.stringify(
        defaultValue
      )} values={${JSON.stringify(tabValues, null, 2)}}>`
    );

    for (const example of doc.examples) {
      lines.push(`<TabItem value=${JSON.stringify(example.key)}>`);
      lines.push("");
      lines.push(example.text);
      lines.push("");
      lines.push(`</TabItem>`);
    }

    lines.push("</Tabs>");
  }

  return lines;
}

async function generateSettingsPage(
  ctx: SettingsGenContext,
  folder: string,
  category: Category,
  prop: ts.PropertyDeclaration,
  doc: ParsedJSDoc
) {
  const fileName = path.join(
    folder,
    prop.name.getText().toLowerCase() + ".mdx"
  );

  const lines: string[] = [
    ...generateSettingsPageFrontMatter(category, prop, doc),
    ...generateSettingsPageDescription(category, prop, doc),
    ...generateSettingsPageTypes(ctx, prop, doc),
    ...generateSettingsPageExamples(doc),
  ];

  await fs.promises.writeFile(fileName, lines.join(EOL));
}

interface SettingsGenContext {
  program: ts.Program;
  declarationFile: ts.SourceFile;
  declarations: Map<string, ts.DeclarationStatement>;
  exportNameLookup: Map<string, string>;
  checker: ts.TypeChecker;
}

function walkSymbolExports(
  ctx: SettingsGenContext,
  prefix: string,
  symbol: ts.Symbol
) {
  if (symbol.exports) {
    for (const [k, v] of symbol.exports) {
      const name = k.toString();

      // direct exports
      if (ctx.declarations.has(name)) {
        ctx.exportNameLookup.set(name, prefix + name);
      } else {
        // declare namespace index_d$3 {
        //  export { index_d$3_AlphaSynthMidiFileHandler as AlphaSynthMidiFileHandler, index_d$3_AlphaTabMetronomeEvent as AlphaTabMetronomeEvent, index_d$3_AlphaTabRestEvent as AlphaTabRestEvent, index_d$3_BeatTickLookup as BeatTickLookup, index_d$3_ControlChangeEvent as ControlChangeEvent, index_d$3_ControllerType as ControllerType, index_d$3_EndOfTrackEvent as EndOfTrackEvent, index_d$3_MasterBarTickLookup as MasterBarTickLookup, index_d$3_MidiEvent as MidiEvent, index_d$3_MidiEventType as MidiEventType, index_d$3_MidiFile as MidiFile, index_d$3_MidiFileFormat as MidiFileFormat, index_d$3_MidiFileGenerator as MidiFileGenerator, index_d$3_MidiTickLookup as MidiTickLookup, index_d$3_MidiTickLookupFindBeatResult as MidiTickLookupFindBeatResult, index_d$3_NoteBendEvent as NoteBendEvent, index_d$3_NoteEvent as NoteEvent, index_d$3_NoteOffEvent as NoteOffEvent, index_d$3_NoteOnEvent as NoteOnEvent, index_d$3_PitchBendEvent as PitchBendEvent, index_d$3_ProgramChangeEvent as ProgramChangeEvent, index_d$3_TempoChangeEvent as TempoChangeEvent, index_d$3_TimeSignatureEvent as TimeSignatureEvent };
        // }

        // export { index_d$1 as platform }
        if (v.declarations) {
          for (const declaration of v.declarations) {
            if (ts.isExportSpecifier(declaration) && declaration.propertyName) {
              // resolve namespace
              const symbol = ctx.checker.getSymbolAtLocation(
                declaration.propertyName
              );
              if (symbol) {
                walkSymbolExports(
                  ctx,
                  prefix + declaration.name.text + ".",
                  symbol
                );
              }
            }
          }
        }
      }
    }
  }
}

function fillExportNameLookup(ctx: SettingsGenContext) {
  const symbol = ctx.checker.getSymbolAtLocation(ctx.declarationFile);
  const prefix = "alphaTab.";
  walkSymbolExports(ctx, prefix, symbol);
}

export async function generateSettingsPages(
  program: ts.Program,
  declarations: Map<string, ts.DeclarationStatement>
) {
  const checker = program.getTypeChecker();
  const declarationFile = program.getSourceFile(program.getRootFileNames()[0]);

  const context: SettingsGenContext = {
    program,
    declarationFile,
    declarations,
    exportNameLookup: new Map<string, string>(),
    checker,
  };
  fillExportNameLookup(context);

  const categories: Category[] = [
    {
      type: "CoreSettings",
      settingsProperty: "core",
      category: "Core",
      jsOnParent: true,
    },
    {
      type: "DisplaySettings",
      settingsProperty: "display",
      category: "Display",
      jsOnParent: false,
    },
    {
      type: "ImporterSettings",
      settingsProperty: "importer",
      category: "Importer",
      jsOnParent: false,
    },
    {
      type: "NotationSettings",
      settingsProperty: "notation",
      category: "Notation",
      jsOnParent: false,
    },
    {
      type: "PlayerSettings",
      settingsProperty: "player",
      category: "Player",
      jsOnParent: false,
    },
  ];

  for (const category of categories) {
    const folder = path.join(
      __dirname,
      "..",
      "docs",
      "reference",
      "settings",
      category.settingsProperty
    );

    const type = declarations.get(category.type) as ts.ClassDeclaration;
    if (!type) {
      throw new Error(`Could not find declaration ${category.type}`);
    }

    await fs.promises.rm(folder, { recursive: true, force: true });
    await fs.promises.mkdir(folder, { recursive: true });

    for (const prop of type.members) {
      if (isMemberProperty(prop)) {
        const jsDoc = ts
          .getJSDocCommentsAndTags(prop)
          .find((d) => ts.isJSDoc(d));
        if (jsDoc) {
          await generateSettingsPage(
            context,
            folder,
            category,
            prop,
            parseJsDoc(jsDoc as ts.JSDoc)
          );
        } else {
          console.warn(
            `Skipping ${
              category.settingsProperty
            }.${prop.name?.getText()}, no jsdoc found`
          );
        }
      }
    }
  }
}
function isMemberProperty(
  prop: ts.ClassElement
): prop is ts.PropertyDeclaration {
  return (
    ts.isPropertyDeclaration(prop) &&
    (!prop.modifiers ||
      !prop.modifiers.find((m) => m.kind === ts.SyntaxKind.StaticKeyword))
  );
}

function getDefaultValue(prop: ts.PropertyDeclaration) {
  const jsDoc = ts
    .getJSDocCommentsAndTags(prop)
    .find((o) => ts.isJSDoc(o)) as ts.JSDoc;
  if (!jsDoc) {
    return "";
  }
  return jsDocToMarkdown(
    jsDoc.tags?.find((t) => t.tagName.text === "default")?.comment ?? ""
  );
}
