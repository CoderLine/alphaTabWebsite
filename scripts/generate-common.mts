import path from "path";
import ts from "typescript";
import { getTypeWithNullableInfo, TypeWithNullableInfo } from "./typeschema";
import { toPascalCase } from "@site/src/names";

export type GenerateContext = {
  checker: ts.TypeChecker;
  settings: ts.ClassDeclaration;
  dts: string;
  nameToExportName: Map<string, string>;
  flatExports: Map<string, ts.DeclarationStatement>;
};

function toExampleKey(title: string) {
  return title
    .toLowerCase()
    .replaceAll("#", "sharp")
    .replaceAll(/[^a-z0-9]/g, "-");
}

export function collectExamples(
  context: GenerateContext,
  node: ts.Node
): { key: string; title: string; markdown: string }[] {
  const examples: { key: string; title: string; markdown: string }[] = [];

  for (const tag of ts.getJSDocTags(node)) {
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

export function isJsonOnParent(node: ts.Node): boolean {
  return !!ts
    .getJSDocTags(node)
    .find((t) => t.tagName.text === "json_on_parent");
}

export function isTargetWeb(node: ts.Node): boolean {
  return !!ts
    .getJSDocTags(node)
    .find((t) => t.tagName.text === "target" && t.comment === "web");
}

export function isDomWildcard(node: ts.Node): boolean {
  return !!ts.getJSDocTags(node).find((t) => t.tagName.text === "domWildcard");
}

export function getJsDocTagText(
  context: GenerateContext,
  node: ts.Node,
  tagName: string
): string {
  return jsDocCommentToMarkdown(
    context,
    ts.getJSDocTags(node).find((t) => t.tagName.text === tagName)?.comment
  );
}

export function getSummary(
  context: GenerateContext,
  node: ts.Node,
  resolveLinks: boolean
): string {
  const jsDoc = ts.getJSDocCommentsAndTags(node);
  if (jsDoc.length > 0 && ts.isJSDoc(jsDoc[0])) {
    return (
      jsDocCommentToMarkdown(context, jsDoc[0].comment, resolveLinks)
        .split("\n")
        .find((l) => l.trim().length > 0)
        ?.trim() ?? ""
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
                  tryGetSettingsLink(context, symbol, comment.name) ??
                  tryGetReferenceLink(context, symbol, comment.name);
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
        text += jsDocCommentToMarkdown(context, n, resolveLinks);
      }
    }

    return text;
  }
  return "";
}

function tryGetSettingsLink(
  context: GenerateContext,
  symbol: ts.Symbol,
  node: ts.Node
): string | undefined {
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
  context: GenerateContext,
  s: ts.Symbol,
  referenceNode: ts.Node,
  throwError: boolean
) {
  if (s.valueDeclaration) {
    return s.valueDeclaration;
  }

  const d = s.declarations?.find(
    (d) =>
      path.basename(d.getSourceFile().fileName) == path.basename(context.dts)
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
  context: GenerateContext,
  symbolOrNode: ts.Symbol | ts.Node,
  referenceNode: ts.Node
): string {
  if ("kind" in symbolOrNode) {
    if (
      path.basename(symbolOrNode.getSourceFile().fileName) !==
      path.basename(context.dts)
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
          tryGetReferenceLink(context, symbolOrNode.parent, referenceNode) +
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
      context,
      symbolOrNode,
      referenceNode,
      false
    );
    if (declaration) {
      return tryGetReferenceLink(context, declaration, referenceNode);
    }

    const type = context.checker.getDeclaredTypeOfSymbol(symbolOrNode);
    declaration = valueOrFirstDeclarationInDts(
      context,
      type.symbol,
      referenceNode,
      true
    );
    return tryGetReferenceLink(context, declaration!, referenceNode);
  }

  return "";
}

function enumTypeToInlineMarkdown(
  context: GenerateContext,
  typeInfo: TypeWithNullableInfo,
  onlyJsEnum: boolean
): string[] {
  const lines: string[] = [];

  const exportedType = context.nameToExportName.get(typeInfo.typeAsString);
  if (
    typeInfo.isEnumType &&
    exportedType &&
    context.flatExports.has(exportedType)
  ) {
    const enumDeclaration = context.flatExports.get(
      exportedType
    ) as ts.EnumDeclaration;
    lines.push(
      "",
      `### [${exportedType}](${tryGetReferenceLink(
        context,
        enumDeclaration,
        enumDeclaration
      )})`,
      "<TypeTable>",
      `  <TypeRow type="${onlyJsEnum ? "all" : "js"}" name=${JSON.stringify(
        exportedType
      )}>`,
      ...enumDeclaration.members.map(
        (member, i, a) =>
          `    \`${member.name.getText()}\` - ${getSummary(
            context,
            member,
            true
          )}${i < a.length - 1 ? "<br />" : ""}`
      ),
      `  </TypeRow>`
    );
    if (!onlyJsEnum) {
      lines.push(
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
            `    \`${getEnumValue(context, member)}\` - ${member.name.getText()} ${
              i < a.length - 1 ? "<br />" : ""
            }`
        ),
        `  </TypeRow>`,

        `  <TypeRow type="net" name=${JSON.stringify(
          toPascalCase(exportedType)
        )}>`,
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
        `  </TypeRow>`
      );
    }
    lines.push("</TypeTable>");
  }

  return lines;
}

export function typeToMarkdown(
  context: GenerateContext,
  type: ts.Type,
  node: ts.Node,
  isOptionalFromDeclaration: boolean
): string {
  const typeInfo = getTypeWithNullableInfo(
    context.checker,
    type,
    true,
    isOptionalFromDeclaration,
    undefined
  );
  let typeString = context.checker.typeToString(type);

  const lines: string[] = [];

  if (typeInfo.isOwnType) {
    const linkUrl =
      tryGetSettingsLink(context, type.symbol, node) ??
      tryGetReferenceLink(context, type.symbol, node);
    if (context.nameToExportName.has(typeString)) {
      typeString = context.nameToExportName.get(typeString)!;
    }

    lines.push(
      "<TypeTable>",
      `    <TypeRow name={${JSON.stringify(typeString)}} url={${JSON.stringify(
        linkUrl
      )}}/>`,
      "</TypeTable>",
      ...enumTypeToInlineMarkdown(context, typeInfo, false)
    );
  } else {
    lines.push(
      "<TypeTable>",
      `    <TypeRow name={${JSON.stringify(typeString)}} />`,
      "</TypeTable>"
    );
  }

  if (typeInfo.typeArguments) {
    for (const t of typeInfo.typeArguments) {
      if (t.isOwnType) {
        lines.push(...enumTypeToInlineMarkdown(context, t, true));
      }
    }
  }

  if (typeInfo.arrayItemType) {
    if (typeInfo.arrayItemType.isOwnType) {
      lines.push(
        ...enumTypeToInlineMarkdown(context, typeInfo.arrayItemType, true)
      );
    }
  }

  // TODO: Nicer named C#/Kotlin types?
  return lines.join("\n");
}

function getEnumValue(context: GenerateContext, m: ts.EnumMember) {
  if (m.initializer) {
    return m.initializer.getText();
  }
  return context.checker.getConstantValue(m);
}
