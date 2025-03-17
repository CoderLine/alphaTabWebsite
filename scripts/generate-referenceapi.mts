import path from "path";
import fs from "fs";
import ts from "typescript";
import {
  getFullDescription,
  getJsDocTagText,
  getSummary,
  isEvent,
  isInternal,
  isOverride,
  isTargetWeb,
  jsDocCommentToMarkdown,
  repositoryRoot,
  toDotNetTypeName,
  toJsTypeName,
  toKotlinTypeName,
  toPascalCase,
  tryGetReferenceLink,
  typeToMarkdown,
  writeExamples,
} from "./generate-common.mjs";
import {
  GenerateContext,
  getTypeWithNullableInfo,
  TypeWithNullableInfo,
  valueOrFirstDeclarationInDts,
} from "./typeschema";

export async function generateReferenceApi(
  context: GenerateContext,
  subPath: string,
  includedTypes: string[]
) {
  for (const t of includedTypes) {
    await internalGenerateReferenceApi(context, subPath, t);
  }
}

async function internalGenerateReferenceApi(
  context: GenerateContext,
  subPath: string,
  typeName: string
) {
  const type = context.flatExports.get(typeName);
  if (!type) {
    throw new Error("Could not find export with name " + typeName);
  }

  switch (type.kind) {
    case ts.SyntaxKind.ClassDeclaration:
      for (const member of (type as ts.ClassDeclaration).members) {
        await generateMember(context, subPath, member);
      }
      break;
    case ts.SyntaxKind.InterfaceDeclaration:
      for (const member of (type as ts.InterfaceDeclaration).members) {
        await generateMember(context, subPath, member);
      }
      break;
  }
}

function shouldGenerateMember(m: ts.TypeElement | ts.ClassElement) {
  if (!m.name) {
    // e.g. constructors
    return false;
  }

  // private or static members
  if (
    ts.canHaveModifiers(m) &&
    m.modifiers?.some(
      (mod) =>
        mod.kind == ts.SyntaxKind.PrivateKeyword ||
        mod.kind == ts.SyntaxKind.StaticKeyword
    )
  ) {
    return false;
  }

  if (isOverride(m) || isInternal(m) || ts.isSetAccessor(m)) {
    return false;
  }

  return true;
}

async function generateMember(
  context: GenerateContext,
  subPath: string,
  m: ts.TypeElement | ts.ClassElement
) {
  if (!shouldGenerateMember(m)) {
    return;
  }

  const basePath = path.join(repositoryRoot, "docs", "reference", subPath);
  const filePath = path.join(
    basePath,
    m.name!.getText().toLowerCase() + ".mdx"
  );

  await fs.promises.mkdir(basePath, { recursive: true });

  const fileStream = fs.createWriteStream(filePath, {
    flags: "w",
  });
  try {
    fileStream.write("---\n");
    fileStream.write(`title: ${m.name!.getText()}\n`);

    fileStream.write(`description: ${getSummary(context, m, false)}\n`);
    fileStream.write(`sidebar_custom_props:\n`);

    let isWebOnly = false;
    if (isTargetWeb(m)) {
      fileStream.write(`  javaScriptOnly: true\n`);
      isWebOnly = true;
    }

    const category =
      getJsDocTagText(context, m, "category") || defaultCategory(m);
    fileStream.write(`  category: ${category}\n`);

    const since = getJsDocTagText(context, m, "since");
    if (since) {
      fileStream.write(`  since: ${since}\n`);
    }

    fileStream.write("---\n");

    fileStream.write(
      "import { SinceBadge } from '@site/src/components/SinceBadge';\n"
    );
    fileStream.write("\n");
    if(since){
      fileStream.write(`<SinceBadge since=${JSON.stringify(since)} />\n`);
    }

    fileStream.write(`\n`);

    let descriptionTag = "";
    const isEventProp = isEvent(m);
    const isProperty =
      ts.isPropertySignature(m) ||
      ts.isPropertyDeclaration(m) ||
      ts.isGetAccessor(m);

    if (isEventProp) {
      fileStream.write(
        `import { EventDescription } from '@site/src/components/EventDescription';\n`
      );
      descriptionTag = "EventDescription";
    } else if (
      ts.isPropertySignature(m) ||
      ts.isPropertyDeclaration(m) ||
      ts.isGetAccessor(m)
    ) {
      fileStream.write(
        `import { PropertyDescription } from '@site/src/components/PropertyDescription';\n`
      );
      descriptionTag = "PropertyDescription";
    }

    fileStream.write(
      `import {TypeTable, TypeRow} from '@site/src/components/TypeTable';\n`
    );
    fileStream.write(
      `import {ParameterTable, ParameterRow} from '@site/src/components/ParameterTable';\n`
    );

    const remarks = getJsDocTagText(context, m, "remarks");
    fileStream.write(`\n## Description\n`);
    fileStream.write(`${getSummary(context, m, true)} ${remarks}\n\n`);

    if (descriptionTag) {
      fileStream.write(`<${descriptionTag} />\n`);
    }

    const importFile = path.join(
      basePath,
      "_" + m.name!.getText().toLowerCase() + ".mdx"
    );

    try {
      await fs.promises.access(importFile, fs.constants.R_OK);

      fileStream.write(
        `\nimport ManualDocs from './_${m
          .name!.getText()
          .toLowerCase()}.mdx';\n`
      );
      fileStream.write("\n");
      fileStream.write(`<ManualDocs />\n`);
    } catch (e) {
      // ignore
    }

    if (isEventProp) {
      generateEventTypeTable(
        fileStream,
        context,
        m as ts.PropertyDeclaration,
        isWebOnly
      );
    } else if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) {
      generateMethodSignatures(fileStream, context, m, isWebOnly);
    } else if (isProperty) {
      generatePropertyTypes(fileStream, context, m, isWebOnly);
    }

    writeExamples(fileStream, context, m);
  } finally {
    fileStream.end();
  }
}

function generateEventTypeTable(
  fileStream: fs.WriteStream,
  context: GenerateContext,
  m: ts.PropertyDeclaration,
  isWebOnly: boolean
) {
  // IEventEmitter
  // IEventEmitterOfT<T>
  const fullType = getTypeWithNullableInfo(
    context,
    m.type!,
    true,
    false,
    undefined,
    m.type!
  );

  fileStream.write(`\n## Types\n`);

  fileStream.write(`\n<TypeTable>\n`);

  const inlineTypes: InlineType[] = [];
  collectInlineTypesFromDoc(context, m, inlineTypes);

  if (fullType.typeArguments) {
    const argsType = fullType.typeArguments![0];

    const exportedType = context.nameToExportName.get(argsType.typeAsString);

    fileStream.write(
      `    <TypeRow type="js" name="function (args: ${toJsTypeName(
        context,
        argsType,
        false,
        m.type!
      )}): void" />\n`
    );
    fileStream.write(
      `    <TypeRow type="net" name="System.Action<${toDotNetTypeName(
        context,
        argsType,
        false,
        m.type!
      )}>" />\n`
    );
    fileStream.write(
      `    <TypeRow type="android" name="(args: ${toKotlinTypeName(
        context,
        argsType,
        false,
        m.type!
      )}) -> Unit" />\n`
    );
    fileStream.write(`</TypeTable>\n\n`);

    if (exportedType) {
      fileStream.write(`## Parameters\n\n`);
      fileStream.write(`<ParameterTable>\n`);

      fileStream.write(
        `    <ParameterRow platform="js" name="args" type="${exportedType}">\n`
      );
      fileStream.write(
        `        The event arguments containing the information for the event.\n`
      );
      fileStream.write(`    </ParameterRow>\n`);

      if (!isWebOnly) {
        fileStream.write(
          `    <ParameterRow platform="net" name="args" type="${toPascalCase(
            exportedType
          )}">\n`
        );
        fileStream.write(
          `        The event arguments containing the information for the event.\n`
        );
        fileStream.write(`    </ParameterRow>\n`);
        fileStream.write(
          `    <ParameterRow platform="android" name="args" type="${exportedType}">\n`
        );
        fileStream.write(
          `        The event arguments containing the information for the event.\n`
        );
        fileStream.write(`    </ParameterRow>\n`);
      }

      fileStream.write(`</ParameterTable>\n\n`);

      inlineTypes.push({
        type: exportedType,
        force: false,
      });
    }
  } else {
    fileStream.write(`    <TypeRow type="js" name="function (): void" />\n`);
    fileStream.write(`    <TypeRow type="net" name="System.Action" />\n`);
    fileStream.write(`    <TypeRow type="android" name="() -> Unit" />\n`);
    fileStream.write(`</TypeTable>\n`);
  }

  writeInlineTypeInfos(fileStream, context, inlineTypes, m.type!, isWebOnly);
}

function writeInlineTypeInfo(
  fileStream: fs.WriteStream,
  context: GenerateContext,
  allInlinedTypes: Map<string, InlineType>,
  exportedType: string,
  referenceNode: ts.Node,
  isWebOnly: boolean,
  force: boolean
) {
  const typeDeclaration = context.flatExports.get(exportedType) as
    | ts.ClassDeclaration
    | ts.InterfaceDeclaration
    | undefined;
  if (!typeDeclaration) {
    return;
  }
  if (
    !force &&
    (exportedType.includes("alphaTab.model") ||
      exportedType.includes("alphaTab.midi"))
  ) {
    return;
  }

  fileStream.write(
    `### [${exportedType}](${tryGetReferenceLink(
      context,
      typeDeclaration,
      referenceNode
    )}) Properties\n\n`
  );

  const description = getFullDescription(context, typeDeclaration);
  if (description) {
    fileStream.write(`${description}\n\n`);
  }

  const since = getJsDocTagText(context, typeDeclaration, "since");
  if (since) {
    fileStream.write(`<SinceBadge inline="true" since="${since}" />\n\n`);
  }

  const deprecated = getJsDocTagText(context, typeDeclaration, "deprecated");
  if (deprecated) {
    fileStream.write(`<strong>Deprecated:</strong> ${deprecated}\n\n`);
  }

  const relevantMembers = typeDeclaration.members.filter(
    (m) =>
      shouldGenerateMember(m) &&
      (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m))
  );

  // collect base type members unless exported
  if (ts.isClassDeclaration(typeDeclaration)) {
    let currentType: ts.ClassDeclaration | undefined = typeDeclaration;
    while (currentType) {
      const extendsClause = currentType.heritageClauses?.find(
        (c) => c.token == ts.SyntaxKind.ExtendsKeyword
      );

      if (!extendsClause) {
        break;
      }

      const baseType = valueOrFirstDeclarationInDts(
        context,
        context.checker.getTypeAtLocation(extendsClause.types[0])?.symbol,
        extendsClause,
        false
      );
      if (baseType && ts.isClassDeclaration(baseType)) {
        const exportName =
          context.nameToExportName.get(baseType.name!.getText()) ??
          baseType.name!.getText();
        if (allInlinedTypes.has(exportName)) {
          break;
        }

        currentType = baseType;
        relevantMembers.push(
          ...currentType.members.filter(
            (m) =>
              shouldGenerateMember(m) &&
              (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m))
          )
        );
      } else {
        break;
      }
    }
  }

  if (relevantMembers.length > 0) {
    fileStream.write(`<ParameterTable>\n`);

    for (const m of relevantMembers) {
      if (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) {
        fileStream.write(
          `    <ParameterRow platform="js" name="${m.name!.getText()}" type="${toJsTypeName(
            context,
            getTypeWithNullableInfo(
              context,
              m.type!,
              false,
              false,
              undefined,
              m.type!
            ),
            !!m.questionToken,
            referenceNode
          )}">\n`
        );

        for (const line of getFullDescription(context, m).split("\n")) {
          fileStream.write(`        ${line}\n`);
        }

        const since = getJsDocTagText(context, m, "since");
        if (since) {
          fileStream.write(
            `        <SinceBadge inline={true} since=${JSON.stringify(
              since
            )} />\n`
          );
        }

        fileStream.write(`    </ParameterRow>\n`);

        if (!isWebOnly) {
          fileStream.write(
            `    <ParameterRow platform="net" name="${toPascalCase(
              m.name!.getText()
            )}" type="${toDotNetTypeName(
              context,
              getTypeWithNullableInfo(
                context,
                m.type!,
                false,
                false,
                undefined,
                m.type!
              ),
              !!m.questionToken,
              referenceNode
            )}">\n`
          );

          for (const line of getFullDescription(context, m).split("\n")) {
            fileStream.write(`        ${line}\n`);
          }

          if (since) {
            fileStream.write(
              `        <SinceBadge inline={true} since=${JSON.stringify(
                since
              )} />\n`
            );
          }

          fileStream.write(`    </ParameterRow>\n`);

          fileStream.write(
            `    <ParameterRow platform="android" name="${m.name!.getText()}" type="${toKotlinTypeName(
              context,
              getTypeWithNullableInfo(
                context,
                m.type!,
                false,
                false,
                undefined,
                m.type!
              ),
              !!m.questionToken,
              referenceNode
            )}">\n`
          );

          for (const line of getFullDescription(context, m).split("\n")) {
            fileStream.write(`        ${line}\n`);
          }

          if (since) {
            fileStream.write(
              `        <SinceBadge inline={true} since=${JSON.stringify(
                since
              )} />\n`
            );
          }

          fileStream.write(`    </ParameterRow>\n`);
        }
      }
    }

    fileStream.write(`</ParameterTable>\n`);
  }
}

function generateMethodSignatures(
  fileStream: fs.WriteStream,
  context: GenerateContext,
  m: ts.MethodSignature | ts.MethodDeclaration,
  isWebOnly: boolean
) {
  fileStream.write(`## Signatures\n\n`);

  fileStream.write(`<TypeTable>\n`);
  fileStream.write(`    <TypeRow type="js" name="${m.getText()}" />\n`);
  if (!isWebOnly) {
    fileStream.write(
      `    <TypeRow type="net" name="${toDotNetTypeName(
        context,
        getTypeWithNullableInfo(
          context,
          m.type!,
          false,
          false,
          undefined,
          m.type!
        ),
        false,
        m
      )} ${toPascalCase(m.name!.getText())}(`
    );

    for (let i = 0; i < m.parameters.length; i++) {
      if (i > 0) {
        fileStream.write(", ");
      }

      fileStream.write(
        toDotNetTypeName(
          context,
          getTypeWithNullableInfo(
            context,
            m.parameters[i].type!,
            false,
            false,
            undefined,
            m.parameters[i].type!
          ),
          !!m.parameters[i].questionToken,
          m.parameters[i].type!
        )
      );
      fileStream.write(` ${m.parameters[i].name.getText()}`);
    }

    fileStream.write(`)" />\n`);

    const fun = m.type!.getText().startsWith("Promise<")
      ? "suspend fun"
      : "fun";
    fileStream.write(
      `    <TypeRow type="android" name="${fun} ${m.name!.getText()}(`
    );

    for (let i = 0; i < m.parameters.length; i++) {
      if (i > 0) {
        fileStream.write(", ");
      }

      fileStream.write(`${m.parameters[i].name.getText()}: `);
      fileStream.write(
        toKotlinTypeName(
          context,
          getTypeWithNullableInfo(
            context,
            m.parameters[i].type!,
            false,
            false,
            undefined,
            m.parameters[i].type!
          ),
          !!m.parameters[i].questionToken,
          m.parameters[i].type!
        )
      );
    }

    fileStream.write(
      `): ${toKotlinTypeName(
        context,
        getTypeWithNullableInfo(
          context,
          m.type!,
          false,
          false,
          undefined,
          m.type!
        ),
        false,
        m
      )}" />\n`
    );
  }
  fileStream.write(`</TypeTable>\n\n`);

  fileStream.write(`### Parameters \n`);
  if (m.parameters.length > 0) {
    fileStream.write(`\n<ParameterTable>\n`);

    for (let i = 0; i < m.parameters.length; i++) {
      fileStream.write(
        `    <ParameterRow platform="js" name="${m.parameters[
          i
        ].name.getText()}" type="${toJsTypeName(
          context,
          getTypeWithNullableInfo(
            context,
            m.parameters[i].type!,
            false,
            false,
            undefined,
            m.parameters[i].type!
          ),
          !!m.parameters[i].questionToken,
          m.parameters[i]
        )}">\n`
      );

      for (const line of getFullDescription(context, m.parameters[i]).split(
        "\n"
      )) {
        fileStream.write(`        ${line}\n`);
      }

      fileStream.write(`    </ParameterRow>\n`);

      if (!isWebOnly) {
        fileStream.write(
          `    <ParameterRow platform="net" name="${m.parameters[
            i
          ].name.getText()}" type="${toDotNetTypeName(
            context,
            getTypeWithNullableInfo(
              context,
              m.parameters[i].type!,
              false,
              false,
              undefined,
              m.parameters[i].type!
            ),
            !!m.parameters[i].questionToken,
            m.parameters[i]
          )}">\n`
        );

        for (const line of getFullDescription(context, m.parameters[i]).split(
          "\n"
        )) {
          fileStream.write(`        ${line}\n`);
        }

        fileStream.write(`    </ParameterRow>\n`);

        fileStream.write(
          `    <ParameterRow platform="android" name="${m.parameters[
            i
          ].name.getText()}" type="${toKotlinTypeName(
            context,
            getTypeWithNullableInfo(
              context,
              m.parameters[i].type!,
              false,
              false,
              undefined,
              m.parameters[i].type!
            ),
            !!m.parameters[i].questionToken,
            m.parameters[i]
          )}">\n`
        );

        for (const line of getFullDescription(context, m.parameters[i]).split(
          "\n"
        )) {
          fileStream.write(`        ${line}\n`);
        }

        fileStream.write(`    </ParameterRow>\n`);
      }
    }
    fileStream.write(`</ParameterTable>\n\n`);
  } else {
    fileStream.write(`None \n\n`);
  }

  fileStream.write(`### Returns \n`);

  const inlineTypes: InlineType[] = [];

  collectInlineTypesFromDoc(context, m, inlineTypes);

  const returnsDoc = getJsDocTagText(context, m, "returns");
  if (returnsDoc) {
    fileStream.write(`${returnsDoc} \n\n`);

    const returnType = getTypeWithNullableInfo(
      context,
      m.type!,
      false,
      false,
      undefined,
      m.type!
    );

    walkTypeCandidates(inlineTypes, returnType);
  } else if (
    context.checker.getVoidType() == context.checker.getTypeAtLocation(m.type!)
  ) {
    fileStream.write(`Nothing \n`);
  }

  writeInlineTypeInfos(fileStream, context, inlineTypes, m.type!, isWebOnly);
}

type InlineType = {
  type: TypeWithNullableInfo | string;
  force: boolean;
};

function writeInlineTypeInfos(
  fileStream: fs.WriteStream,
  context: GenerateContext,
  inlineTypes: InlineType[],
  referenceNode: ts.Node,
  isWebOnly: boolean
) {
  const exportedTypeNames = new Map<string, InlineType>(
    inlineTypes
      .map((type) => {
        const exportedName =
          typeof type.type === "string"
            ? type.type
            : (context.nameToExportName.get(type.type.typeAsString) as string);
        if (exportedName) {
          type.type = exportedName;
          return [exportedName, type] as [string, InlineType];
        }
        return ["", type] as [string, InlineType];
      })
      .filter((x) => x[0].length > 0)
  );

  for (const [_, exportedType] of exportedTypeNames) {
    writeInlineTypeInfo(
      fileStream,
      context,
      exportedTypeNames,
      exportedType.type as string,
      referenceNode,
      isWebOnly,
      exportedType.force
    );
  }
}

function generatePropertyTypes(
  fileStream: fs.WriteStream,
  context: GenerateContext,
  m: ts.PropertySignature | ts.PropertyDeclaration | ts.GetAccessorDeclaration,
  isWebOnly: boolean
) {
  // TODO: document if readonly

  fileStream.write(`\n## Types\n\n`);

  const propertyType = getTypeWithNullableInfo(
    context,
    m.type!,
    false,
    false,
    undefined,
    m.type!
  );

  fileStream.write(`<TypeTable>\n`);
  fileStream.write(
    `    <TypeRow type="js" name="${toJsTypeName(
      context,
      propertyType,
      !!m.questionToken,
      m
    )}" />\n`
  );

  if (!isWebOnly) {
    fileStream.write(
      `    <TypeRow type="net" name="${toDotNetTypeName(
        context,
        propertyType,
        !!m.questionToken,
        m
      )}" />\n`
    );
    fileStream.write(
      `    <TypeRow type="android" name="${toKotlinTypeName(
        context,
        propertyType,
        !!m.questionToken,
        m
      )}" />\n`
    );
  }

  fileStream.write(`</TypeTable>\n`);

  const defaultValue = getJsDocTagText(context, m, "defaultValue");
  if (defaultValue) {
    fileStream.write(`## Default Value\n\n`);
    fileStream.write(`${defaultValue}\n`);
  }

  const inlineTypes: InlineType[] = [];
  collectInlineTypesFromDoc(context, m, inlineTypes);

  inlineTypes.push({
    type: propertyType,
    force: false,
  });

  writeInlineTypeInfos(fileStream, context, inlineTypes, m.type!, isWebOnly);
}

function walkTypeCandidates(
  candidateTypes: InlineType[],
  type: TypeWithNullableInfo
) {
  if (type.isArray) {
    walkTypeCandidates(candidateTypes, type.arrayItemType!);
  } else if (type.typeArguments) {
    for (const t of type.typeArguments) {
      walkTypeCandidates(candidateTypes, t);
    }
  } else if (type.isOwnType) {
    candidateTypes.push({
      type,
      force: false,
    });
  }
}
function collectInlineTypesFromDoc(
  context: GenerateContext,
  m: ts.Node,
  inlineTypes: InlineType[]
) {
  // @see {@link Reference}
  const seeTags = ts.getJSDocTags(m);
  for (const see of seeTags) {
    if (
      see.tagName.text === "see" &&
      see.comment &&
      typeof see.comment !== "string"
    ) {
      let referencedType: ts.Symbol | undefined;
      for (const c of see.comment) {
        switch (c.kind) {
          case ts.SyntaxKind.JSDocText:
            // skip if there is more than just a link (some whitespace items might exist)
            if (c.text.trim().length > 0) {
              referencedType = undefined;
              break;
            }
            break;
          case ts.SyntaxKind.JSDocLink:
          case ts.SyntaxKind.JSDocLinkCode:
          case ts.SyntaxKind.JSDocLinkPlain:
            if (c.name) {
              referencedType = context.checker.getSymbolAtLocation(c.name);
            }
            break;
        }
      }

      if (referencedType) {
        const declaration = valueOrFirstDeclarationInDts(
          context,
          referencedType,
          m,
          false
        );
        if (declaration) {
          switch (declaration.kind) {
            case ts.SyntaxKind.ClassDeclaration:
            case ts.SyntaxKind.InterfaceDeclaration:
            case ts.SyntaxKind.EnumDeclaration:
              let name = (declaration as ts.NamedDeclaration).name!.getText();
              if (context.nameToExportName.has(name)) {
                name = context.nameToExportName.get(name)!;
              }

              inlineTypes.push({
                type: name,
                force: true,
              });
              break;
          }
        }
      }
    }
  }
}
function defaultCategory(m: ts.TypeElement | ts.ClassElement): string {
  if (isEvent(m)) {
    return "Events";
  }
  if (
    ts.isPropertyDeclaration(m) ||
    ts.isPropertySignature(m) ||
    ts.isGetAccessor(m) ||
    ts.isSetAccessor(m)
  ) {
    return "Properties";
  }
  if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) {
    return "Methods";
  }

  return "General";
}
