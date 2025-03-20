import path from "path";
import fs from "fs";
import {
  GenerateContext,
  getTypeWithNullableInfo,
  repositoryRoot,
  TypeWithNullableInfo,
} from "./typeschema";
import {
  collectMembers,
  getFullDescription,
  getJsDocTagText,
  getSummary,
  isEvent,
  toJsTypeName,
  tryGetReferenceLink,
  writeCommonImports,
  writeEventDetails,
  writeMethodDetails,
  writePropertyDetails,
} from "./generate-common.mjs";
import ts from "typescript";
import { FileStream, openFileStream } from "./util";

export async function generateTypeDocs(context: GenerateContext) {
  for (const [exportedName, exportedType] of context.flatExports) {
    const parts = exportedName.split(".");
    if (parts[0] === "alphaTab") {
      parts.shift();
    }

    const basePath = path.join(
      repositoryRoot,
      "docs",
      "reference",
      "types",
      ...parts.map((p) => p.toLowerCase())
    );

    const filePath = path.join(basePath, "index.mdx");

    await fs.promises.mkdir(basePath, { recursive: true });

    await using fileStream = await openFileStream(filePath);
    await fileStream.write("---\n");
    await fileStream.write(`sidebar_label: ${exportedType.name!.getText()}\n`);
    await fileStream.write(`title: ${exportedName}\n`);
    await fileStream.write("---\n");

    await writeCommonImports(fileStream);

    await fileStream.write(
      `\n<DynHeading as="h3" inlined={props.inlined}>Description</DynHeading>\n\n`
    );
    await fileStream.write(`${getFullDescription(context, exportedType)}\n\n`);

    if (
      ts.isClassDeclaration(exportedType) ||
      ts.isInterfaceDeclaration(exportedType) ||
      ts.isTypeAliasDeclaration(exportedType)
    ) {
      const linkMap = new Map<string, string>();
      let definition = "";
      if (exportedType.modifiers) {
        for (const m of exportedType.modifiers) {
          switch (m.kind) {
            case ts.SyntaxKind.AbstractKeyword:
              definition += " abstract";
              break;
          }
        }
      }

      if (ts.isClassDeclaration(exportedType)) {
        definition += " class";
      } else if (ts.isInterfaceDeclaration(exportedType)) {
        definition += " interface";
      } else if (ts.isTypeAliasDeclaration(exportedType)) {
        definition += " type";
      }
      definition += " " + exportedType.name!.getText();

      if (
        exportedType.typeParameters &&
        exportedType.typeParameters.length > 0
      ) {
        definition += "<";
        definition += exportedType.typeParameters
          .map((p) => p.name.getText())
          .join(", ");
        definition += ">";
      }

      if (ts.isTypeAliasDeclaration(exportedType)) {
        definition += " = " + exportedType.type.getText();

        walkTypeForLinks(
          context,
          linkMap,
          getTypeWithNullableInfo(context, exportedType.type, true, false)
        );
      } else if (exportedType.heritageClauses) {
        for (const clause of exportedType.heritageClauses) {
          switch (clause.token) {
            case ts.SyntaxKind.ExtendsKeyword:
              definition += " extends";
              break;
            case ts.SyntaxKind.ImplementsKeyword:
              definition += " implements";
              break;
          }

          definition +=
            " " +
            clause.types
              .map((t) => {
                walkTypeForLinks(
                  context,
                  linkMap,
                  getTypeWithNullableInfo(context, t, true, false)
                );
                return t.getText();
              })
              .join(", ");
        }
      }

      const metaString = JSON.stringify(
        Array.from(linkMap.entries())
          .map((e) => `link${e[0]}="${e[1]}"`)
          .join(" ")
      );

      await fileStream.write(
        `<CodeBlock metastring={${metaString}} language="ts">{\`${definition.trim()}\`}</CodeBlock>\n`
      );

      const properties: (
        | ts.PropertyDeclaration
        | ts.PropertySignature
        | ts.GetAccessorDeclaration
      )[] = [];

      const events: (
        | ts.PropertyDeclaration
        | ts.PropertySignature
        | ts.GetAccessorDeclaration
      )[] = [];

      const methods: (ts.MethodDeclaration | ts.MethodSignature)[] = [];

      const members: Map<string, ts.ClassElement | ts.TypeElement> = new Map();
      if (!ts.isTypeAliasDeclaration(exportedType)) {
        collectMembers(context, members, exportedType);

        const sortedMembers = Array.from(members.values()).sort((a, b) => {
          return a.name!.getText().localeCompare(b.name!.getText());
        });

        for (const m of sortedMembers) {
          if (isEvent(context, m)) {
            events.push(m as (typeof events)[0]);
          } else if (
            ts.isPropertyDeclaration(m) ||
            ts.isPropertySignature(m) ||
            ts.isGetAccessorDeclaration(m)
          ) {
            properties.push(m);
          } else if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) {
            methods.push(m);
          }
        }

        await writeProperties(
          context,
          fileStream,
          basePath,
          exportedType,
          properties
        );
        await writeMethods(
          context,
          fileStream,
          basePath,
          exportedType,
          methods
        );
        await writeEvents(context, fileStream, basePath, exportedType, events);
      }
    } else if (ts.isEnumDeclaration(exportedType)) {
      await writeEnumMembers(context, fileStream, exportedType);
    }
  }
}

async function writeProperties(
  context: GenerateContext,
  fileStream: FileStream,
  basePath: string,
  parent: ts.ClassDeclaration | ts.InterfaceDeclaration,
  properties: (
    | ts.PropertyDeclaration
    | ts.PropertySignature
    | ts.GetAccessorDeclaration
  )[]
) {
  if (properties.length === 0) {
    return;
  }

  await fileStream.write(
    `\n<DynHeading as="h3" inlined={props.inlined}>Properties</DynHeading>\n\n`
  );

  await fileStream.write(
    `<table className="table table-striped table-condensed type-table">\n`
  );
  await fileStream.write(`  <tbody>\n`);

  for (const member of properties) {
    await fileStream.write(`    <tr>\n`);

    const referenceLink = tryGetReferenceLink(context, member);

    if (referenceLink) {
      await fileStream.write(
        `      <td>[\`${member.name.getText()}\`](${referenceLink})</td>\n`
      );
    } else {
      await fileStream.write(`      <td>\`${member.name.getText()}\`</td>\n`);
    }

    const typeInfo = getTypeWithNullableInfo(
      context,
      member.type,
      true,
      !!member.questionToken
    );
    const typeReferenceLink = tryGetReferenceLink(context, typeInfo);

    if (typeReferenceLink) {
      await fileStream.writeLine(
        `      {props.detailed && (<td><Link to={${JSON.stringify(typeReferenceLink)}}><code>{${JSON.stringify(toJsTypeName(context, typeInfo))}}</code></Link></td>)}`
      );
    } else {
      await fileStream.writeLine(
        `      {props.detailed && (<td><code>{${JSON.stringify(toJsTypeName(context, typeInfo))}}</code></td>)}`
      );
    }

    let defaultValue = getJsDocTagText(context, member, "defaultValue");
    if(!defaultValue) {
      defaultValue = '(no default)';
    }
    await fileStream.writeLine(`      {props.detailed && <td><code>{${JSON.stringify(defaultValue)}}</code></td>}`);

    let description =
      getSummary(context, member, true, true) +
      getInheritenceInfo(context, parent, member);

    await fileStream.write(`      <td>\n`);
    await fileStream.write(
      `${description
        .split("\n")
        .map((l) => `        ${l}`)
        .join("\n")}\n`
    );
    await fileStream.write(`      </td>\n`);

    await fileStream.write(`    </tr>\n`);

    await writePropertyPage(context, basePath, member);
  }
  await fileStream.write(`  </tbody>\n`);
  await fileStream.write(`</table>\n`);
}

async function writeMethods(
  context: GenerateContext,
  fileStream: FileStream,
  basePath: string,
  parent: ts.ClassDeclaration | ts.InterfaceDeclaration,
  methods: (ts.MethodDeclaration | ts.MethodSignature)[]
) {
  if (methods.length === 0) {
    return;
  }

  await fileStream.write(
    `\n<DynHeading as="h3" inlined={props.inlined}>Methods</DynHeading>\n\n`
  );

  await fileStream.write(
    `<table className="table table-striped table-condensed type-table">\n`
  );
  await fileStream.write(`  <tbody>\n`);

  for (const member of methods) {
    await fileStream.write(`    <tr>\n`);

    const parameters = member.parameters
      .map((p) => p.type!.getText())
      .join(", ");
    await fileStream.write(
      `      <td>[\`${member.name.getText()}(${parameters})\`](./${member.name
        .getText()
        .toLowerCase()}.mdx)</td>\n`
    );

    let description =
      getSummary(context, member, true, true) +
      getInheritenceInfo(context, parent, member);
    await fileStream.write(`      <td>\n`);
    await fileStream.write(
      `${description
        .split("\n")
        .map((l) => `        ${l}`)
        .join("\n")}\n`
    );
    await fileStream.write(`      </td>\n`);

    await fileStream.write(`    </tr>\n`);

    await writeMethodPage(context, basePath, member);
  }
  await fileStream.write(`  </tbody>\n`);
  await fileStream.write(`</table>\n`);
}

async function writeEvents(
  context: GenerateContext,
  fileStream: FileStream,
  basePath: string,
  parent: ts.ClassDeclaration | ts.InterfaceDeclaration,
  events: (
    | ts.PropertyDeclaration
    | ts.PropertySignature
    | ts.GetAccessorDeclaration
  )[]
) {
  if (events.length === 0) {
    return;
  }

  await fileStream.write(
    `\n<DynHeading as="h3" inlined={props.inlined}>Events</DynHeading>\n\n`
  );

  await fileStream.write(
    `<table className="table table-striped table-condensed type-table">\n`
  );
  await fileStream.write(`  <tbody>\n`);

  for (const member of events) {
    await fileStream.write(`    <tr>\n`);

    await fileStream.write(
      `      <td>[\`${member.name.getText()}\`](./${member.name
        .getText()
        .toLowerCase()}.mdx)</td>\n`
    );

    let description =
      getSummary(context, member, true, true) +
      getInheritenceInfo(context, parent, member);
    await fileStream.write(`      <td>\n`);
    await fileStream.write(
      `${description
        .split("\n")
        .map((l) => `        ${l}`)
        .join("\n")}\n`
    );
    await fileStream.write(`      </td>\n`);

    await fileStream.write(`    </tr>\n`);

    await writeEventPage(context, basePath, member);
  }
  await fileStream.write(`  </tbody>\n`);
  await fileStream.write(`</table>\n`);
}

async function writeEnumMembers(
  context: GenerateContext,
  fileStream: FileStream,
  exportedType: ts.EnumDeclaration
) {
  await fileStream.write(
    `\n<DynHeading as="h3" inlined={props.inlined}>Enum Members</DynHeading>\n\n`
  );

  await fileStream.write(
    `<table className="table table-striped table-condensed type-table">\n`
  );
  await fileStream.write(
    `  <thead><tr><th>Name</th><th>Numeric Value</th><th>Description</th></tr></thead>\n`
  );
  await fileStream.write(`  <tbody>\n`);

  for (const member of exportedType.members) {
    await fileStream.write(`    <tr>\n`);

    await fileStream.write(
      `      <td id="${member.name.getText().toLowerCase()}">\`${member.name.getText()}\`</td>\n`
    );

    const numericValue = context.checker.getConstantValue(member);
    await fileStream.write(`      <td>\`${numericValue}\`</td>\n`);

    let description = getFullDescription(context, member);
    const since = getJsDocTagText(context, member, "since");
    if (since) {
      description = `${description}\n        <SinceBadge inline={true} since="${since}" />`;
    }

    await fileStream.write(`      <td>\n`);
    await fileStream.write(
      `${description
        .split("\n")
        .map((l) => `        ${l}`)
        .join("\n")}\n`
    );
    await fileStream.write(`      </td>\n`);

    await fileStream.write(`    </tr>\n`);
  }
  await fileStream.write(`  </tbody>\n`);
  await fileStream.write(`</table>\n`);
}

async function writeFrontMatter(
  context: GenerateContext,
  fileStream: FileStream,
  memberName: string,
  member: ts.ClassElement | ts.TypeElement,
  kind: string
) {
  await fileStream.write("---\n");
  await fileStream.write(`title: ${memberName}\n`);
  await fileStream.write(`sidebar_custom_props:\n`);
  await fileStream.write(`  kind: ${kind}\n`);

  const since = getJsDocTagText(context, member, "since");
  if (since) {
    await fileStream.write(`  since: ${since}\n`);
  }

  await fileStream.write("---\n");

  await writeCommonImports(fileStream);

  if (since) {
    await fileStream.write(`<SinceBadge since=${JSON.stringify(since)} />\n`);
  }
}

async function writePropertyPage(
  context: GenerateContext,
  basePath: string,
  member:
    | ts.PropertyDeclaration
    | ts.PropertySignature
    | ts.GetAccessorDeclaration
) {
  let memberName = member.name!.getText();
  let fileName = memberName.toLowerCase();
  if (memberName === "index") {
    fileName = "index_";
  }

  const filePath = path.join(basePath, fileName + ".mdx");

  await using fileStream = await openFileStream(filePath);

  await writeFrontMatter(context, fileStream, memberName, member, "property");
  await writePropertyDetails(context, fileStream, member);
}

async function writeEventPage(
  context: GenerateContext,
  basePath: string,
  member:
    | ts.PropertyDeclaration
    | ts.PropertySignature
    | ts.GetAccessorDeclaration
) {
  const memberName = member.name!.getText();
  const filePath = path.join(basePath, memberName.toLocaleLowerCase() + ".mdx");

  await using fileStream = await openFileStream(filePath);

  await writeFrontMatter(context, fileStream, memberName, member, "event");
  await writeEventDetails(context, fileStream, member);
}

async function writeMethodPage(
  context: GenerateContext,
  basePath: string,
  member: ts.MethodDeclaration | ts.MethodSignature
) {
  const memberName = member.name!.getText();
  const filePath = path.join(basePath, memberName.toLocaleLowerCase() + ".mdx");

  await using fileStream = await openFileStream(filePath);

  await writeFrontMatter(context, fileStream, memberName, member, "method");
  await writeMethodDetails(context, fileStream, member);
}

function getInheritenceInfo(
  context: GenerateContext,
  parent: ts.ClassDeclaration | ts.InterfaceDeclaration,
  member: ts.ClassElement | ts.TypeElement
) {
  let info = "";
  // inheritence info
  if (member.parent !== parent) {
    info += " (Inherited from ";
    const referenceLink = tryGetReferenceLink(
      context,
      member.parent as ts.ClassDeclaration | ts.InterfaceDeclaration
    );

    let name = (member.parent as ts.NamedDeclaration).name!.getText();
    if (context.nameToExportName.has(name)) {
      name = context.nameToExportName.get(name)!;
    }

    if (referenceLink) {
      info += `[${name}](${referenceLink})`;
    } else {
      info += name;
    }

    info += ")";
  }
  return info;
}

function walkTypeForLinks(
  context: GenerateContext,
  linkMap: Map<string, string>,
  type: TypeWithNullableInfo
) {
  if (type.isUnionType) {
    for (const t of type.unionTypes!) {
      walkTypeForLinks(context, linkMap, t);
    }
  } else {
    if (type.isOwnType) {
      const reference = tryGetReferenceLink(context, type);
      if (reference) {
        linkMap.set(type.symbol!.name, reference);
      }
    }

    if (type.typeArguments) {
      for (const t of type.typeArguments) {
        walkTypeForLinks(context, linkMap, t);
      }
    }
  }
}
