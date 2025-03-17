import path from "path";
import fs from "fs";
import ts from "typescript";
import {
  getFullDescription,
  getJsDocTagText,
  getSummary,
  isDomWildcard,
  isJsonOnParent,
  isTargetWeb,
  repositoryRoot,
  toDotNetTypeName,
  toJsTypeName,
  toKotlinTypeName,
  typeNameAndUrl,
  typeToMarkdown,
  writeExamples,
} from "./generate-common.mjs";
import { GenerateContext } from "./typeschema";

export async function generateSettings(context: GenerateContext) {
  // Write settings  mdx
  for (const m of context.settings.members) {
    const isStatic =
      ts.canHaveModifiers(m) &&
      m.modifiers?.some((mod) => mod.kind == ts.SyntaxKind.StaticKeyword);

    if (ts.isPropertyDeclaration(m) && !isStatic) {
      const basePath = path.join(
        repositoryRoot,
        "docs",
        "reference",
        "settings",
        m.name.getText().toLowerCase()
      );

      const subSettingType =
        context.checker.getTypeAtLocation(m).symbol.valueDeclaration;
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
                `description: ${JSON.stringify(
                  getSummary(context, subSettingProp, false)
                )}\n`
              );
              fileStream.write(`sidebar_custom_props:\n`);

              const isWebOnly = isTargetWeb(subSettingProp);
              if (isWebOnly) {
                fileStream.write(`  javaScriptOnly: true\n`);
              }

              if (isDomWildcard(subSettingProp)) {
                fileStream.write(`  domWildcard: true\n`);
              }

              if (isJsonOnParent(m)) {
                fileStream.write(`  jsOnParent: true\n`);
              }

              fileStream.write(
                `  category: ${getJsDocTagText(
                  context,
                  subSettingProp,
                  "category"
                )}\n`
              );

              const since = getJsDocTagText(context, subSettingProp, "since");
              fileStream.write(`  since: ${since}\n`);

              fileStream.write("---\n");

              fileStream.write(
                "import { CodeBadge } from '@site/src/components/CodeBadge';\n\n"
              );
              fileStream.write(
                "import { SinceBadge } from '@site/src/components/SinceBadge';\n\n"
              );

              fileStream.write(
                "import { SettingsHeader } from '@site/src/components/SettingsHeader';\n\n"
              );
              fileStream.write(`<SettingsHeader />\n`);

              fileStream.write(`\n### Description\n`);
              fileStream.write(
                `${getFullDescription(context, subSettingProp)}\n\n`
              );

              try {
                const importFile = path.join(
                  basePath,
                  "_" + subSettingProp.name.getText().toLowerCase() + ".mdx"
                );
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

              const defaultValue = getJsDocTagText(
                context,
                subSettingProp,
                "defaultValue"
              );
              if (defaultValue) {
                fileStream.write(`\n### Default Value\n\n`);
                fileStream.write(`${defaultValue}\n`);
              }

              const typeInfo = typeNameAndUrl(
                context,
                context.checker.getTypeAtLocation(subSettingProp),
                subSettingProp
              );

              if (!typeInfo.referenceUrl) {
                if (isWebOnly) {
                  fileStream.write(
                    `\n### Type: \`${toJsTypeName(
                      context,
                      typeInfo.typeInfo,
                      !!subSettingProp.questionToken,
                      subSettingProp
                    )}\`\n\n`
                  );
                } else {
                  fileStream.write(`\n### Type\n\n`);

                  // TODO: link to known types of arrays, maps, sets etc.
                  fileStream.write(
                    `<CodeBadge type="js" name="${toJsTypeName(
                      context,
                      typeInfo.typeInfo,
                      !!subSettingProp.questionToken,
                      subSettingProp
                    )}" />`
                  );
                  fileStream.write(
                    `<CodeBadge type="net" name="${toDotNetTypeName(
                      context,
                      typeInfo.typeInfo,
                      !!subSettingProp.questionToken,
                      subSettingProp
                    )}" />`
                  );
                  fileStream.write(
                    `<CodeBadge type="android" name="${toKotlinTypeName(
                      context,
                      typeInfo.typeInfo,
                      !!subSettingProp.questionToken,
                      subSettingProp
                    )}" />`
                  );
                }
              } else {
                fileStream.write(
                  `\n## Type: [\`${typeInfo.fullName}\`](${typeInfo.referenceUrl})\n\n`
                );

                fileStream.write(
                  `import ${typeInfo.simpleName}Docs from '@site${typeInfo.referenceUrl}';\n\n<${typeInfo.simpleName}Docs />`
                );
              }

              writeExamples(fileStream, context, subSettingProp);
            } finally {
              fileStream.end();
            }
          }
        }
      }
    }
  }
}
