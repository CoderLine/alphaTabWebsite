import path from "path";
import fs from "fs";
import { GenerateContext, repositoryRoot } from "./typeschema";

export async function generateTypeDocs(context: GenerateContext) {
  for (const [exportedName, exportedType] of context.flatExports) {
    const parts = exportedName.split(".");
    if (parts[0] === "alphaTab") {
      parts.shift();
    }

    const filePath =
      path.join(
        repositoryRoot,
        "docs",
        "reference",
        "types",
        ...parts.map((p) => p.toLowerCase())
      ) + ".mdx";

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    const fileStream = fs.createWriteStream(filePath, {
      flags: "w",
    });
    try {
      const typeName = exportedType.name!.getText();
      fileStream.write("---\n");
      fileStream.write(`title: ${exportedType.name!.getText()}\n`);
      fileStream.write("---\n");
      fileStream.write("TODO: Reference docs for " + typeName);
    } finally {
      fileStream.end();
    }
  }
}
