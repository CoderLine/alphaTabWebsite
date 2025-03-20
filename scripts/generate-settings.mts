import path from "path";
import fs from "fs";
import ts from "typescript";
import {
  disableWarningsOnMissingDocs,
  enableWarningsOnMissingDocs,
  getCategory,
  getJsDocTagText,
  getSummary,
  isDomWildcard,
  isJsonOnParent,
  isTargetWeb,
  repositoryRoot,
  writePropertyDetails,
} from "./generate-common.mjs";
import { GenerateContext } from "./typeschema";
import { openFileStream } from "./util";

export async function generateSettings(context: GenerateContext) {
  enableWarningsOnMissingDocs();
  try {
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
          for (const member of subSettingType.members) {
            const isSubSettingPropStatic =
              ts.canHaveModifiers(member) &&
              member.modifiers?.some(
                (mod) => mod.kind == ts.SyntaxKind.StaticKeyword
              );

            if (
              ts.isPropertyDeclaration(member) &&
              !isSubSettingPropStatic
            ) {
              const settingFile = path.join(
                basePath,
                member.name.getText().toLowerCase() + ".mdx"
              );

              await fs.promises.mkdir(basePath, { recursive: true });

              await using fileStream = await openFileStream(settingFile);
              await fileStream.write("---\n");
              await fileStream.write(
                `title: ${m.name.getText()}.${member.name.getText()}\n`
              );

              await fileStream.write(
                `description: ${JSON.stringify(
                  getSummary(context, member, false)
                )}\n`
              );
              await fileStream.write(`sidebar_custom_props:\n`);

              const isWebOnly = isTargetWeb(context, member);
              if (isWebOnly) {
                await fileStream.write(`  javaScriptOnly: true\n`);
              }

              if (isDomWildcard(context, member)) {
                await fileStream.write(`  domWildcard: true\n`);
              }

              if (isJsonOnParent(context, m)) {
                await fileStream.write(`  jsOnParent: true\n`);
              }

              await fileStream.write(
                `  category: ${getCategory(context, member, '')}\n`
              );

              const since = getJsDocTagText(context, member, "since");
              await fileStream.write(`  since: ${since}\n`);

              await fileStream.write("---\n");

              await fileStream.write(
                "import { CodeBadge } from '@site/src/components/CodeBadge';\n\n"
              );
              await fileStream.write(
                "import { SinceBadge } from '@site/src/components/SinceBadge';\n\n"
              );

              await fileStream.write(
                "import { SettingsHeader } from '@site/src/components/SettingsHeader';\n\n"
              );
              await fileStream.write(`<SettingsHeader />\n`);

              await writePropertyDetails(context, fileStream, member);
            }
          }
        }
      }
    }
  } finally {
    disableWarningsOnMissingDocs();
  }
}
