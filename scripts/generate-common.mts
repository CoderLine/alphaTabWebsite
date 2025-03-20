import path from "path";
import fs from "fs";
import ts from "typescript";
import {
  GenerateContext,
  getTypeWithNullableInfo,
  TypeWithNullableInfo,
  valueOrFirstDeclarationInDts,
} from "./typeschema";
import { toPascalCase } from "@site/src/names";
import { styleText } from "util";
import { FileStream } from "./util";

export { toPascalCase } from "@site/src/names";

function toExampleKey(title: string) {
  return title
    .toLowerCase()
    .replaceAll("#", "sharp")
    .replaceAll(/[^a-z0-9]/g, "-");
}

export { repositoryRoot } from "./typeschema";

export function collectExamples(
  context: GenerateContext,
  node: ts.Node
): { key: string; title: string; markdown: string }[] {
  const examples: { key: string; title: string; markdown: string }[] = [];

  for (const tag of getJSDocTags(context, node)) {
    if (tag.tagName.text === "example") {
      const [title, ...markdown] = jsDocCommentToMarkdown(
        context,
        tag.comment
      ).split("\n");
      examples.push({
        key: toExampleKey(title.trim()),
        title: title.trim(),
        markdown: markdown.join("\n").trim(),
      });
    }
  }

  return examples;
}

export function isJsonOnParent(
  context: GenerateContext,
  node: ts.Node
): boolean {
  return !!getJSDocTags(context, node).find(
    (t) => t.tagName.text === "json_on_parent"
  );
}

export function isEvent(context: GenerateContext, node: ts.Node): boolean {
  return !!getJSDocTags(context, node).find(
    (t) => t.tagName.text === "eventProperty"
  );
}

export function isTargetWeb(context: GenerateContext, node: ts.Node): boolean {
  let isWebOnly = !!getJSDocTags(context, node).find(
    (t) => t.tagName.text === "target" && t.comment === "web"
  );

  if (!isWebOnly) {
    switch (node.kind) {
      case ts.SyntaxKind.MethodSignature:
      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.PropertySignature:
      case ts.SyntaxKind.PropertyDeclaration:
      case ts.SyntaxKind.EnumMember:
        isWebOnly = isTargetWeb(context, node.parent);
        break;
    }
  }

  return isWebOnly;
}

export function isDomWildcard(
  context: GenerateContext,
  node: ts.Node
): boolean {
  return !!getJSDocTags(context, node).find(
    (t) => t.tagName.text === "domWildcard"
  );
}

export function getCategory(
  context: GenerateContext,
  node: ts.Node,
  fallbackCategory: string
): string {
  const category = getJsDocTagText(context, node, "category");
  if (category) {
    return category;
  }

  if (isEvent(context, node)) {
    return "Events" + fallbackCategory;
  }
  switch (node.kind) {
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.PropertySignature:
    case ts.SyntaxKind.GetAccessor:
      return "Properties" + fallbackCategory;
    case ts.SyntaxKind.MethodSignature:
    case ts.SyntaxKind.MethodDeclaration:
      return "Methods" + fallbackCategory;
  }

  cconsole.warn("Unknown category for kind", ts.SyntaxKind[node.kind]);
  return "General";
}

function hasJSDocInheritDocTag(node: ts.Node) {
  return ts
    .getJSDocTags(node)
    .some(
      (tag) =>
        tag.tagName.text === "inheritDoc" || tag.tagName.text === "inheritdoc"
    );
}

function getBaseTypeList(
  context: GenerateContext,
  node: ts.ClassDeclaration | ts.InterfaceDeclaration
): (ts.ClassDeclaration | ts.InterfaceDeclaration)[] {
  let baseTypes: (ts.ClassDeclaration | ts.InterfaceDeclaration)[] = [];
  switch (node.kind) {
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.InterfaceDeclaration:
      const clauses = node.heritageClauses;
      if (clauses) {
        for (const h of clauses) {
          for (const t of h.types) {
            const type = context.checker.getTypeAtLocation(t);
            if (type.symbol) {
              const decl = valueOrFirstDeclarationInDts(context, type.symbol);
              if (
                decl &&
                (ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl))
              ) {
                baseTypes.push(decl);
              }
            }
          }
        }
      }
      break;
  }
  return baseTypes;
}
function findBaseOfDeclaration<T>(
  context: GenerateContext,
  node: ts.Node,
  selector: (baseNode: ts.Node) => T | undefined
): T | undefined {
  let baseTypes: (ts.ClassDeclaration | ts.InterfaceDeclaration)[];

  switch (node.kind) {
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.InterfaceDeclaration:
      baseTypes = getBaseTypeList(
        context,
        node as ts.ClassDeclaration | ts.InterfaceDeclaration
      );

      for (const t of baseTypes) {
        const v = selector(t);
        if (v !== undefined) {
          return v;
        }
      }
      return undefined;

    case ts.SyntaxKind.MethodSignature:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.PropertySignature:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
      baseTypes = getBaseTypeList(
        context,
        node.parent as ts.ClassDeclaration | ts.InterfaceDeclaration
      );

      for (const t of baseTypes) {
        const member = t.members.find(
          (m) =>
            m.name?.getText() ===
            (node as ts.ClassElement | ts.TypeElement).name?.getText()
        );
        if (member) {
          const v = selector(member);
          if (v !== undefined) {
            return v;
          }
        }
      }

      break;
  }

  return undefined;
}

export function getJSDocCommentsAndTags(
  context: GenerateContext,
  node: ts.Node
) {
  if (hasJSDocInheritDocTag(node)) {
    const base = findBaseOfDeclaration(context, node, (baseNode) => {
      if (hasJSDocInheritDocTag(baseNode)) {
        return undefined;
      }
      const docs = ts.getJSDocCommentsAndTags(baseNode);
      if (docs.length === 0) {
        return undefined;
      }
      return docs;
    });
    if (base) {
      return base;
    }
  }
  return ts.getJSDocCommentsAndTags(node);
}

export function getJSDocTags(context: GenerateContext, node: ts.Node) {
  if (hasJSDocInheritDocTag(node)) {
    const base = findBaseOfDeclaration(context, node, (baseNode) => {
      if (hasJSDocInheritDocTag(baseNode)) {
        return undefined;
      }
      const tags = ts.getJSDocTags(baseNode);
      if (tags.length > 0) {
        return tags;
      }
      return undefined;
    });
    if (base) {
      return base;
    }
  }
  return ts.getJSDocTags(node);
}

export function getJsDocTagText(
  context: GenerateContext,
  node: ts.Node,
  tagName: string
): string {
  return jsDocCommentToMarkdown(
    context,
    getJSDocTags(context, node).find((t) => t.tagName.text === tagName)?.comment
  );
}

export function getSummary(
  context: GenerateContext,
  node: ts.Node,
  resolveLinks: boolean,
  shorten: boolean = true
): string {
  const jsDoc = getJSDocCommentsAndTags(context, node);
  if ((jsDoc.length > 1 && ts.isJSDoc(jsDoc[0])) || jsDoc.length === 1) {
    const text = jsDocCommentToMarkdown(
      context,
      jsDoc[0].comment,
      resolveLinks
    );
    if (shorten) {
      return (
        text
          .split("\n")
          .find((l) => l.trim().length > 0)
          ?.trim() ?? ""
      );
    } else {
      return text;
    }
  }

  return "";
}

let warnOnMissingDescription = false;
export function enableWarningsOnMissingDocs() {
  warnOnMissingDescription = true;
}

export function disableWarningsOnMissingDocs() {
  warnOnMissingDescription = false;
}

export function getFullDescription(context: GenerateContext, node: ts.Node) {
  const description = `${getSummary(
    context,
    node,
    true,
    false
  )} ${getJsDocTagText(context, node, "remarks")}`.trim();

  if (!description) {
    const isOwn =
      path.basename(node.getSourceFile().fileName) ===
      path.basename(context.dts);
    if (isOwn && warnOnMissingDescription) {
      let name =
        "name" in node ? (node.name as ts.Node).getText() : node.getText();

      if (ts.isParameter(node)) {
        name =
          (node.parent.parent as ts.NamedDeclaration).name!.getText() +
          "." +
          node.parent.name!.getText() +
          "(" +
          name +
          ")";
      } else if (
        ts.isClassDeclaration(node.parent) ||
        ts.isInterfaceDeclaration(node.parent)
      ) {
        name = node.parent.name!.getText() + "." + name;
      }

      cconsole.warn(
        "Missing description for",
        name,
        "at",
        node.getSourceFile().fileName,
        node.getSourceFile().getLineAndCharacterOfPosition(node.pos)
      );
    }

    return "(no description)";
  }

  return description;
}

function rewriteJsDocText(s: string): string {
  return s
    .replaceAll("https://alphatab.net/", "/")
    .replaceAll("https://www.alphatab.net/", "/")
    .replaceAll(/\{@since ([^}]+)\}/g, (_, since) => {
      return `<SinceBadge inline={true} since={${JSON.stringify(since)}} />`;
    })
    .replaceAll(/\{@([^}]+)\}/g, (match) => {
      return `\`${match}\``;
    });
}

export function jsDocCommentToMarkdown(
  context: GenerateContext,
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
                  symbol = context.checker.getSymbolAtLocation(
                    comment.name.left
                  );
                } else if (ts.isJSDocMemberName(comment.name)) {
                  symbol = context.checker.getSymbolAtLocation(
                    comment.name.left
                  );
                }

                symbol = symbol?.members?.get(
                  ts.escapeLeadingUnderscores("name")
                );
              } else {
                symbol = context.checker.getSymbolAtLocation(comment.name);
              }

              if (symbol) {
                linkUrl =
                  tryGetSettingsLink(context, symbol) ??
                  tryGetReferenceLink(context, symbol);
              } else {
                cconsole.error(
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
        text += jsDocCommentToMarkdown(context, n, resolveLinks);
      }
    }

    return text;
  }
  return "";
}

function tryGetSettingsLink(
  context: GenerateContext,
  symbol: ts.Symbol
): string | undefined {
  if (!symbol) {
    return undefined;
  }

  if ("parent" in symbol && symbol.parent) {
    const parentSymbol = symbol.parent as ts.Symbol;
    if (parentSymbol.name.endsWith("Settings")) {
      const settingsProp = context.settings.members.find(
        (m) =>
          ts.isPropertyDeclaration(m) &&
          m.type &&
          context.checker.getTypeAtLocation(m.type).symbol == symbol.parent
      );
      if (settingsProp) {
        return `/docs/reference/settings/${settingsProp
          .name!.getText()
          .toLowerCase()}/${symbol.name.toLowerCase()}`;
      } else {
        cconsole.warn(
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

export function tryGetReferenceLink(
  context: GenerateContext,
  element:
    | TypeWithNullableInfo
    | ts.Symbol
    | ts.ClassElement
    | ts.TypeElement
    | ts.EnumMember
    | ts.TypeParameterDeclaration
    | ts.ClassDeclaration
    | ts.InterfaceDeclaration
    | ts.TypeAliasDeclaration
    | ts.EnumDeclaration,
  warnOnMissingReference: boolean = true
): string {
  // TODO: better generation of type references, we can have multiple links e.g. Map<NoteElement, Beat> where
  // all identifiers get their own links.

  if ("kind" in element) {
    const fileName = element.getSourceFile().fileName;

    if (path.basename(fileName) !== path.basename(context.dts)) {
      // mdn.io
      if (
        fileName.includes("typescript") &&
        fileName.includes("lib") &&
        fileName.includes("d.ts")
      ) {
        const symbol =
          context.checker.getSymbolAtLocation(element) ??
          context.checker.getTypeAtLocation(element).symbol;
        if (symbol) {
          return "https://mdn.io/" + symbol.name;
        }
      }

      return "";
    }

    switch (element.kind) {
      case ts.SyntaxKind.ClassDeclaration:
      case ts.SyntaxKind.EnumDeclaration:
      case ts.SyntaxKind.InterfaceDeclaration:
      case ts.SyntaxKind.TypeAliasDeclaration:
        let name = (element as ts.DeclarationStatement).name!.getText();
        if (context.nameToExportName.has(name)) {
          name = context.nameToExportName.get(name)!;
          if (name.startsWith("alphaTab.")) {
            name = name.substring(9);
          }
        } else {
          cconsole.warn(
            `Type ${name} is not exported, no documentation generated and cross reference not linked`
          );
          return "";
        }

        return `/docs/reference/types/${name
          .replaceAll(".", "/")
          .toLowerCase()}/`;

      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.MethodSignature:
      case ts.SyntaxKind.Constructor:
      case ts.SyntaxKind.GetAccessor:
      case ts.SyntaxKind.SetAccessor:
      case ts.SyntaxKind.PropertyDeclaration:
      case ts.SyntaxKind.PropertySignature:
        return (
          tryGetReferenceLink(
            context,
            element.parent as ts.ClassDeclaration | ts.InterfaceDeclaration
          ) + (element as ts.ClassElement).name!.getText().toLowerCase()
        );
      case ts.SyntaxKind.EnumMember:
        return (
          tryGetReferenceLink(context, element.parent as ts.EnumDeclaration) +
          "#" +
          (element as ts.EnumMember).name!.getText().toLowerCase()
        );
      case ts.SyntaxKind.TypeParameter:
        return "";
      default:
        cconsole.error(
          "Unhandled node kind",
          ts.SyntaxKind[element.kind],
          "at",
          element.getSourceFile().fileName,
          element.getSourceFile().getLineAndCharacterOfPosition(element.pos),
          element.getText()
        );
    }
  } else if ("isOwnType" in element) {
    if (element.fullString === "any" || element.fullString === "unknown") {
      return "";
    } else if (element.isPrimitiveType || element.isTypedArray) {
      return "https://mdn.io/" + element.ownTypeAsString;
    } else if (element.isArray) {
      return tryGetReferenceLink(context, element.arrayItemType!);
    } else if (element.isFunctionType) {
      return "";
    } else if (element.isTypeLiteral) {
      return "";
    } else if (element.isOwnType) {
      let declaration = valueOrFirstDeclarationInDts(context, element.symbol!);
      if (declaration) {
        return tryGetReferenceLink(context, declaration as any);
      }
    } else if (element.typeArguments) {
      // currently we mostly have one own type in generics (e.g. maps, sets etc.)
      for (const a of element.typeArguments) {
        if (a.isOwnType || a.isUnionType) {
          const reference = tryGetReferenceLink(context, a, false);
          if (reference) {
            return reference;
          }
        }
      }

      // there are maps with only primitives
      return "";
    } else if (element.isUnionType) {
      for (const a of element.unionTypes!) {
        const reference = tryGetReferenceLink(context, a, false);
        if (reference) {
          return reference;
        }
      }
    } else {
      let declaration = valueOrFirstDeclarationInDts(context, element.symbol!);
      if (declaration) {
        return tryGetReferenceLink(context, declaration as any);
      }
    }
  } else {
    let declaration = valueOrFirstDeclarationInDts(context, element);
    if (declaration) {
      return tryGetReferenceLink(context, declaration as any);
    }
  }

  if (warnOnMissingReference) {
    cconsole.error("Failed to resolve reference link for ", element);
  }
  return "";
}

export async function writeExamples(
  fileStream: FileStream,
  context: GenerateContext,
  element: ts.Node
) {
  const examples = collectExamples(context, element);
  if (examples.length === 1) {
    await fileStream.write(`\n## Example - ${examples[0].title}\n\n`);
    await fileStream.write(`${examples[0].markdown}\n`);
  } else if (examples.length > 1) {
    await fileStream.write(`\n## Examples\n\n`);
    await fileStream.write("<Tabs\n");
    await fileStream.write(
      `    defaultValue=${JSON.stringify(examples[0].key)}\n`
    );
    await fileStream.write(`    values={[\n`);

    for (let i = 0; i < examples.length; i++) {
      await fileStream.write(
        `      { label: ${JSON.stringify(
          examples[i].title
        )}, value: ${JSON.stringify(examples[i].key)}}`
      );
      if (i < examples.length - 1) {
        await fileStream.write(`,\n`);
      } else {
        await fileStream.write(`\n`);
      }
    }

    await fileStream.write(`    ]}\n`);
    await fileStream.write(`>\n`);

    for (const example of examples) {
      await fileStream.write(
        `<TabItem value=${JSON.stringify(example.key)}>\n`
      );

      await fileStream.write(`${example.markdown}\n`);

      await fileStream.write(`</TabItem>\n`);
    }

    await fileStream.write(`</Tabs>\n`);
  }
}

export function toJsTypeName(
  context: GenerateContext,
  type: TypeWithNullableInfo
): string {
  return type.fullString;
}

export function toDotNetTypeName(
  context: GenerateContext,
  type: TypeWithNullableInfo
): string {
  const nullableSuffix = type.isNullable || type.isOptional ? "?" : "";

  if (type.isPrimitiveType) {
    switch (type.ownTypeAsString) {
      case "number":
        return "double" + nullableSuffix;
      case "string":
        return "string" + nullableSuffix;
      case "boolean":
        return "bool" + nullableSuffix;
      case "BigInt":
        return "long" + nullableSuffix;
      case "unknown":
        return "object" + nullableSuffix;
    }
  }

  if (type.isArray) {
    return (
      "IList<" +
      toDotNetTypeName(context, type.arrayItemType!) +
      ">" +
      nullableSuffix
    );
  }

  let baseName: string = type.ownTypeAsString;

  switch (baseName) {
    case "void":
      return "void";
    case "Error":
      return "System.Exception";
    case "Promise":
      baseName = "Task";
      break;
  }

  if (context.nameToExportName.has(baseName)) {
    baseName = toPascalCase(context.nameToExportName.get(baseName)!);
  } else {
    baseName = toPascalCase(baseName);
  }

  if (type.typeArguments && type.typeArguments.length > 0) {
    baseName += "<";
    baseName += type.typeArguments
      .map((a) => toDotNetTypeName(context, a))
      .join(", ");
    baseName += ">";
  }

  return baseName + nullableSuffix;
}

export function toKotlinTypeName(
  context: GenerateContext,
  type: TypeWithNullableInfo
): string {
  const nullableSuffix = type.isNullable || type.isOptional ? "?" : "";

  if (type.isPrimitiveType) {
    switch (type.ownTypeAsString) {
      case "number":
        return "Double" + nullableSuffix;
      case "string":
        return "String" + nullableSuffix;
      case "boolean":
        return "Boolean" + nullableSuffix;
      case "BigInt":
        return "Long" + nullableSuffix;
      case "unknown":
        return "Any" + nullableSuffix;
    }
  }

  if (type.isArray) {
    if (type.arrayItemType!.isPrimitiveType) {
      switch (type.arrayItemType!.ownTypeAsString) {
        case "boolean":
          return "alphaTab.collections.BooleanList";
        case "number":
          return "alphaTab.collections.DoubleList";
      }
    }

    return (
      "alphaTab.collections.List<" +
      toKotlinTypeName(context, type.arrayItemType!) +
      ">" +
      nullableSuffix
    );
  }

  let baseName: string = type.ownTypeAsString;

  switch (baseName) {
    case "void":
      return "Unit";
    case "Error":
      return "kotlin.Throwable";
  }

  if (context.nameToExportName.has(baseName)) {
    baseName = context.nameToExportName.get(baseName)!;
  }

  if (type.typeArguments && type.typeArguments.length > 0) {
    if (baseName === "Promise") {
      return toKotlinTypeName(context, type.typeArguments[0]);
    } else if (
      baseName === "Map" &&
      (type.typeArguments[0].isPrimitiveType ||
        type.typeArguments[1].isPrimitiveType)
    ) {
      const keyPart = type.typeArguments[0].isPrimitiveType
        ? toKotlinTypeName(context, type.typeArguments[0])
        : "Object";

      const valuePart = type.typeArguments[1].isPrimitiveType
        ? toKotlinTypeName(context, type.typeArguments[1])
        : "Object";

      return "alphaTab.collections." + keyPart + valuePart + "Map";
    } else {
      baseName += "<";
      baseName += type.typeArguments
        .map((a) => toKotlinTypeName(context, a))
        .join(", ");
      baseName += ">";
    }
  } else if (baseName === "Promise") {
    baseName = "Unit";
  }

  return baseName + nullableSuffix;
}

export function isOverride(context: GenerateContext, node: ts.Node) {
  const tags = getJSDocTags(context, node);

  if (tags.find((t) => t.tagName.text === "inheritdoc")) {
    return true;
  }

  return false;
}

export function isInternal(context: GenerateContext, node: ts.Node) {
  const tags = getJSDocTags(context, node);

  if (tags.find((t) => t.tagName.text === "internal")) {
    return true;
  }

  return false;
}

export async function writeEventDetails(
  context: GenerateContext,
  fileStream: FileStream,
  member:
    | ts.PropertySignature
    | ts.PropertyDeclaration
    | ts.GetAccessorDeclaration
) {
  await writeCommonDescription(context, fileStream, member);

  await writeEventSignatures(context, fileStream, member);

  await writeManualDocs(fileStream, member);

  await writeExamples(fileStream, context, member);
}

export async function writeEventSignatures(
  context: GenerateContext,
  fileStream: FileStream,
  member:
    | ts.PropertySignature
    | ts.PropertyDeclaration
    | ts.GetAccessorDeclaration
) {
  await writePropertySignatures(context, fileStream, member);
}

export async function writeMethodDetails(
  context: GenerateContext,
  fileStream: FileStream,
  member: ts.MethodDeclaration | ts.MethodSignature
) {
  await writeCommonDescription(context, fileStream, member);

  await writeMethodSignatures(context, fileStream, member);
  await writeMethodParameters(context, fileStream, member);
  await writeMethodReturn(context, fileStream, member);

  await writeManualDocs(fileStream, member);

  await writeExamples(fileStream, context, member);
}

export async function writeMethodReturn(
  context: GenerateContext,
  fileStream: FileStream,
  m: ts.MethodDeclaration | ts.MethodSignature
) {
  const returnsDoc = getJsDocTagText(context, m, "returns");
  if (returnsDoc) {
    await fileStream.write(`### Returns \n`);
    await fileStream.write(`${returnsDoc} \n\n`);
  }
}

export async function writeMethodParameters(
  context: GenerateContext,
  fileStream: FileStream,
  m: ts.MethodDeclaration | ts.MethodSignature
) {
  if (m.parameters.length > 0) {
    await fileStream.write(`\n<ParameterTable>\n`);

    for (let i = 0; i < m.parameters.length; i++) {
      await fileStream.write(
        `    <ParameterRow platform="all" name="${m.parameters[
          i
        ].name.getText()}">\n`
      );

      for (const line of getFullDescription(context, m.parameters[i]).split(
        "\n"
      )) {
        await fileStream.write(`        ${line}\n`);
      }

      await fileStream.write(`    </ParameterRow>\n`);
    }
    await fileStream.write(`</ParameterTable>\n\n`);
  }
}

export async function writeMethodSignatures(
  context: GenerateContext,
  fileStream: FileStream,
  m: ts.MethodDeclaration | ts.MethodSignature
) {
  const isWebOnly = isTargetWeb(context, m);

  if (!isWebOnly) {
    await fileStream.writeLine(
      `<Tabs defaultValue="js" values={[{label: "JavaScript", value: "js"},{label: "C#", value: "cs"},{label:"Kotlin", value: "kt"}]}>`
    );
    await fileStream.writeLine(`<TabItem value="js">`);
  }

  await fileStream.write(
    `<CodeBlock language="ts">{\`${m.getText()}\`}</CodeBlock>\n`
  );

  if (!isWebOnly) {
    await fileStream.writeLine(`</TabItem>`);
    await fileStream.writeLine(`<TabItem value="cs">`);

    await fileStream.write(`<CodeBlock language="csharp">{\``);

    await fileStream.write(
      toDotNetTypeName(
        context,
        getTypeWithNullableInfo(context, m.type, false, false)
      )
    );

    await fileStream.write(` ${toPascalCase(m.name!.getText())}(`);

    for (let i = 0; i < m.parameters.length; i++) {
      if (i > 0) {
        await fileStream.write(", ");
      }

      await fileStream.write(
        toDotNetTypeName(
          context,
          getTypeWithNullableInfo(
            context,
            m.parameters[i].type,
            false,
            !!m.parameters[i].questionToken
          )
        )
      );
      await fileStream.write(` ${m.parameters[i].name.getText()}`);
    }

    await fileStream.write(`)\`}</CodeBlock>\n`);

    await fileStream.writeLine(`</TabItem>`);
    await fileStream.writeLine(`<TabItem value="kt">`);

    const fun = m.type!.getText().startsWith("Promise<")
      ? "suspend fun"
      : "fun";

    await fileStream.write(`<CodeBlock language="kotlin">{\``);
    await fileStream.write(`${fun} ${m.name!.getText()}(`);

    for (let i = 0; i < m.parameters.length; i++) {
      if (i > 0) {
        await fileStream.write(", ");
      }

      await fileStream.write(`${m.parameters[i].name.getText()}: `);
      await fileStream.write(
        toKotlinTypeName(
          context,
          getTypeWithNullableInfo(
            context,
            m.parameters[i].type,
            false,
            !!m.parameters[i].questionToken
          )
        )
      );
    }

    await fileStream.write(
      `): ${toKotlinTypeName(
        context,
        getTypeWithNullableInfo(context, m.type, false, false)
      )}\`}</CodeBlock>\n`
    );

    await fileStream.writeLine(`</TabItem>`);
    await fileStream.writeLine(`</Tabs>`);
  }

  await fileStream.writeLine();
}

export async function writeCommonImports(fileStream: FileStream) {
  await fileStream.writeLine();
  await fileStream.writeLine(
    "import { ParameterTable, ParameterRow } from '@site/src/components/ParameterTable';"
  );
  await fileStream.writeLine("import CodeBlock from '@theme/CodeBlock';");
  await fileStream.writeLine('import Tabs from "@theme/Tabs";');
  await fileStream.writeLine('import TabItem from "@theme/TabItem";');
  await fileStream.writeLine(
    "import { CodeBadge } from '@site/src/components/CodeBadge';"
  );
  await fileStream.writeLine(
    "import { SinceBadge } from '@site/src/components/SinceBadge';"
  );
  await fileStream.writeLine(
    "import DynHeading from '@site/src/components/DynHeading';"
  );
  await fileStream.writeLine("import Link from '@docusaurus/Link';");

  await fileStream.writeLine();
}

async function writeCommonDescription(
  context: GenerateContext,
  fileStream: FileStream,
  member: ts.TypeElement | ts.ClassElement
) {
  await fileStream.write(`\n### Description\n`);
  await fileStream.write(`${getFullDescription(context, member)}\n\n`);
}

export async function writeManualDocs(
  fileStream: FileStream,
  member: ts.TypeElement | ts.ClassElement
) {
  try {
    const importFile = path.join(
      path.dirname(fileStream.path),
      "_" + member.name!.getText().toLowerCase() + ".mdx"
    );
    await fs.promises.access(importFile, fs.constants.R_OK);

    await fileStream.write(
      `\nimport ManualDocs from './_${member
        .name!.getText()
        .toLowerCase()}.mdx';\n`
    );
    await fileStream.write("\n");
    await fileStream.write(`<ManualDocs />\n`);
  } catch (e) {
    // ignore
  }
}

export async function writePropertyDetails(
  context: GenerateContext,
  fileStream: FileStream,
  member:
    | ts.PropertySignature
    | ts.PropertyDeclaration
    | ts.GetAccessorDeclaration
) {
  await writeCommonDescription(context, fileStream, member);

  await writePropertySignatures(context, fileStream, member);

  await writeManualDocs(fileStream, member);

  await writeExamples(fileStream, context, member);
}

export const cconsole = {
  log: (...args) => {
    console.log(...args);
  },
  debug: (...args) => {
    console.log(
      ...args.map((a) => (typeof a === "string" ? styleText(["dim"], a) : a))
    );
  },

  info: (...args) => {
    console.log(
      ...args.map((a) => (typeof a === "string" ? styleText(["blue"], a) : a))
    );
  },

  warn: (...args) => {
    console.log(
      ...args.map((a) => (typeof a === "string" ? styleText(["yellow"], a) : a))
    );
  },

  error: (...args) => {
    console.log(
      ...args.map((a) => (typeof a === "string" ? styleText(["red"], a) : a))
    );
  },
};

function shouldGenerateMember(
  context: GenerateContext,
  m: ts.TypeElement | ts.ClassElement
) {
  if (!m.name) {
    // e.g. constructors
    return false;
  }

  // private
  if (
    ts.canHaveModifiers(m) &&
    m.modifiers?.some(
      (mod) =>
        mod.kind == ts.SyntaxKind.PrivateKeyword ||
        mod.kind === ts.SyntaxKind.ProtectedKeyword
    )
  ) {
    return false;
  }

  if (isInternal(context, m) || ts.isSetAccessor(m)) {
    return false;
  }

  return true;
}

export function collectMembers(
  context: GenerateContext,
  members: Map<string, ts.ClassElement | ts.TypeElement>,
  exportedType: ts.ClassDeclaration | ts.InterfaceDeclaration,
  collectBase: boolean = true
) {
  for (const m of exportedType.members) {
    if (shouldGenerateMember(context, m) && !members.has(m.name!.getText())) {
      members.set(m.name!.getText(), m);
    }
  }

  const extendsClause = exportedType.heritageClauses?.find(
    (c) => c.token === ts.SyntaxKind.ExtendsKeyword
  );
  if (extendsClause && collectBase) {
    const symbol = context.checker.getTypeAtLocation(
      extendsClause.types[0]
    ).symbol;
    const baseType = valueOrFirstDeclarationInDts(context, symbol);
    if (
      baseType &&
      (ts.isClassDeclaration(baseType) || ts.isInterfaceDeclaration(baseType))
    ) {
      collectMembers(context, members, baseType);
    } else if (symbol.members) {
      for (const [_, member] of symbol.members) {
        const decl = valueOrFirstDeclarationInDts(context, member);
        if (decl) {
          if (ts.isClassElement(decl) || ts.isTypeElement(decl)) {
            if (
              shouldGenerateMember(context, decl) &&
              !members.has(decl.name!.getText())
            ) {
              members.set(decl.name!.getText(), decl);
            }
          }
        }
      }
    }
  }
}

async function writePropertySignatures(
  context: GenerateContext,
  fileStream: FileStream,
  m: ts.PropertySignature | ts.PropertyDeclaration | ts.GetAccessorDeclaration
) {
  const isWebOnly = isTargetWeb(context, m);

  if (!isWebOnly) {
    await fileStream.writeLine(
      `<Tabs defaultValue="js" values={[{label: "JavaScript", value: "js"},{label: "C#", value: "cs"},{label:"Kotlin", value: "kt"}]}>`
    );
    await fileStream.writeLine(`<TabItem value="js">`);
  }

  await fileStream.write(`<CodeBlock language="ts">{\``);

  if (m.modifiers) {
    for (const mod of m.modifiers) {
      switch (mod.kind) {
        case ts.SyntaxKind.AccessorKeyword:
          break;
        default:
          await fileStream.write(mod.getText() + " ");
          break;
      }
    }
  }

  const isReadonlyAccessor =
    ts.isGetAccessor(m) &&
    !(m.parent as ts.ClassDeclaration | ts.InterfaceDeclaration).members.some(
      (p) => ts.isSetAccessor(p) && p.name.getText() === m.name.getText()
    );

  if (isReadonlyAccessor) {
    await fileStream.write("readonly ");
  }

  await fileStream.write(m.name.getText());
  if (m.questionToken) {
    await fileStream.write(m.questionToken.getText());
  }
  await fileStream.write(" : ");
  if (m.type) {
    await fileStream.write(m.type.getText());
  }

  let defaultValue = getJsDocTagText(context, m, "defaultValue");
  let defaultValueIsCode = defaultValue.startsWith("`");
  if (defaultValueIsCode) {
    defaultValue = defaultValue.substring(1, defaultValue.length - 1);
  }

  defaultValue = defaultValue.replaceAll("`", "\\`");
  defaultValue = defaultValue.replaceAll("${", "$\\{");

  if (
    defaultValue &&
    !(m.parent as ts.NamedDeclaration).name!?.getText().endsWith("Json")
  ) {
    await fileStream.write(` = `);
    if (defaultValueIsCode) {
      await fileStream.write(`${defaultValue}`);
    } else {
      await fileStream.write(`/* ${defaultValue} */`);
    }
  }

  await fileStream.write(`;`);

  await fileStream.write(`\`}</CodeBlock>\n`);

  if (!isWebOnly) {
    await fileStream.writeLine(`</TabItem>`);
    await fileStream.writeLine(`<TabItem value="cs">`);

    await fileStream.write(`<CodeBlock language="csharp">{\``);

    const isReadonly =
      m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ReadonlyKeyword) ||
      (ts.isGetAccessor(m) &&
        !(
          m.parent as ts.ClassDeclaration | ts.InterfaceDeclaration
        ).members.some(
          (p) => ts.isSetAccessor(p) && p.name.getText() === m.name.getText()
        ));
    const isStatic = m.modifiers?.some(
      (mod) => mod.kind === ts.SyntaxKind.StaticKeyword
    );
    const isAbstract = m.modifiers?.some(
      (mod) => mod.kind === ts.SyntaxKind.AbstractKeyword
    );

    if (isStatic) {
      await fileStream.write(`static `);
    }

    if (isAbstract) {
      await fileStream.write(`abstract `);
    }

    await fileStream.write(
      toDotNetTypeName(
        context,
        getTypeWithNullableInfo(context, m.type, false, false)
      )
    );

    await fileStream.write(` ${toPascalCase(m.name!.getText())} { get; `);

    if (!isReadonly) {
      await fileStream.write(`set; `);
    }

    await fileStream.write(`}`);

    if (defaultValue) {
      await fileStream.write(` = `);
      await fileStream.write(`${defaultValue}`);
    }

    await fileStream.write(`\`}</CodeBlock>\n`);

    await fileStream.writeLine(`</TabItem>`);
    await fileStream.writeLine(`<TabItem value="kt">`);

    const val = isReadonly ? "val" : "var";

    await fileStream.write(`<CodeBlock language="kotlin">{\``);

    if (isAbstract) {
      await fileStream.write(`abstract `);
    }

    if (isStatic) {
      await fileStream.write(`companion object {`);
    }

    await fileStream.write(`${val} ${m.name!.getText()}`);

    await fileStream.write(
      `: ${toKotlinTypeName(
        context,
        getTypeWithNullableInfo(context, m.type, false, false)
      )}`
    );

    if (defaultValue) {
      await fileStream.write(` = `);
      await fileStream.write(`${defaultValue}`);
    }

    if (isStatic) {
      await fileStream.write(` }`);
    }

    await fileStream.write(`\`}</CodeBlock>\n`);

    await fileStream.writeLine(`</TabItem>`);
    await fileStream.writeLine(`</Tabs>`);
  }

  await fileStream.writeLine();
}
