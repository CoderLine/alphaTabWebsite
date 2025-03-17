import path from "path";
import fs from "fs";
import ts from "typescript";
import {
  getJsDocTagText,
  getSummary,
  isDomWildcard,
  isJsonOnParent,
  isTargetWeb,
  repositoryRoot,
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
                `description: ${getSummary(context, subSettingProp, false)}\n`
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
                "import { SinceBadge } from '@site/src/components/SinceBadge';\n"
              );
              fileStream.write("\n");
              fileStream.write(
                `<SinceBadge since=${JSON.stringify(since)} />\n`
              );
              fileStream.write(`\n`);
              fileStream.write(
                `import { PropertyDescription } from '@site/src/components/PropertyDescription';\n`
              );
              fileStream.write(
                `import {TypeTable, TypeRow} from '@site/src/components/TypeTable';\n`
              );

              // fileStream.write(`## Summary\n`);
              // fileStream.write(`${summary}\n\n`);

              const remarks = getJsDocTagText(
                context,
                subSettingProp,
                "remarks"
              );
              fileStream.write(`\n## Description\n`);
              if (remarks) {
                fileStream.write(`${remarks}\n\n`);
              } else {
                fileStream.write(
                  `${getSummary(context, subSettingProp, true)}\n\n`
                );
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
                  context,
                  context.checker.getTypeAtLocation(subSettingProp),
                  subSettingProp,
                  !!subSettingProp.questionToken
                )}\n`
              );

              const defaultValue = getJsDocTagText(
                context,
                subSettingProp,
                "defaultValue"
              );
              if (defaultValue) {
                fileStream.write(`\n## Default Value\n\n`);
                fileStream.write(`${defaultValue}\n`);
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
