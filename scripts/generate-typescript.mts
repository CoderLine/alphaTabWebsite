import path from "path";
import fs from "fs";
import ts from "typescript";
import { jsDocCommentToMarkdown, repositoryRoot } from "./generate-common.mjs";
import { GenerateContext } from "./typeschema";

const outDir = path.resolve(repositoryRoot, "src", "alphatabdoc");

export async function generateTypeScript(context: GenerateContext) {
  // create typescript modules with metadata exported
  for (const [identifier, d] of context.flatExports.entries()) {
    if (ts.isEnumDeclaration(d)) {
      await writeEnumDeclaration(context, d, identifier);
    } else if (ts.isClassDeclaration(d)) {
      await writeClassDeclaration(context, d, identifier);
    } else if (ts.isInterfaceDeclaration(d)) {
      await writeInterfaceDeclaration(context, d, identifier);
    }
  }
}

async function writeEnumDeclaration(
  context: GenerateContext,
  d: ts.EnumDeclaration,
  exportedName: string
) {
  await writeType(exportedName, {
    name: exportedName,
    kind: "enum",
    tsdoc: jsDocSchema(context, d),
    members: d.members.map((m) => {
      return {
        name: m.name.getText(),
        kind: "enummember",
        tsdoc: jsDocSchema(context, m),
      };
    }),
  });
}

async function writeClassDeclaration(
  context: GenerateContext,
  d: ts.ClassDeclaration,
  exportedName: string
) {
  await writeType(exportedName, {
    name: exportedName,
    kind: "class",
    tsdoc: jsDocSchema(context, d),
    members: d.members
      .map((m) => mapMemberSchema(context, d, m))
      .filter((m) => !!m),
  });
}

async function writeInterfaceDeclaration(
  context: GenerateContext,
  d: ts.InterfaceDeclaration,
  exportedName: string
) {
  await writeType(exportedName, {
    name: exportedName,
    kind: "interface",
    tsdoc: jsDocSchema(context, d),
  });
}

function mapMemberSchema(
  context: GenerateContext,
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
  let isStatic =
    ts.canHaveModifiers(e) &&
    e.modifiers?.some((m) => m.kind == ts.SyntaxKind.StaticKeyword);

  switch (e.kind) {
    case ts.SyntaxKind.MethodDeclaration:
      return {
        name: e.name!.getText(),
        kind: "method",
        tsdoc: jsDocSchema(context, e),
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
      type = context.checker.typeToString(context.checker.getTypeAtLocation(e));
      return {
        name: e.name!.getText(),
        kind: "property",
        type: type,
        static: isStatic,
        readonly: (e as ts.PropertyDeclaration).modifiers?.some(
          (m) => m.kind == ts.SyntaxKind.ReadonlyKeyword
        ),
        tsdoc: jsDocSchema(context, e),
      };
    case ts.SyntaxKind.GetAccessor:
      type = context.checker.typeToString(context.checker.getTypeAtLocation(e));
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
        tsdoc: jsDocSchema(context, e),
      };
  }
  return undefined;
}

function jsDocSchema(context: GenerateContext, d: ts.Node) {
  const comments = ts.getJSDocCommentsAndTags(d);

  const jsDoc = {
    doc: "",
    tags: {} as Record<string, string>,
  };

  if (comments.length > 0) {
    let i = 0;
    if (ts.isJSDoc(comments[0])) {
      jsDoc.doc = jsDocCommentToMarkdown(context, comments[0].comment);
      if (comments[0].tags) {
        for (const t of comments[0].tags) {
          jsDoc.tags[t.tagName.text] = jsDocCommentToMarkdown(
            context,
            t.comment
          );
        }
      }
      i++;
    }

    for (; i < comments.length; i++) {
      const tag = comments[i];
      if (!ts.isJSDoc(tag)) {
        jsDoc.tags[tag.tagName.text] = jsDocCommentToMarkdown(
          context,
          tag.comment
        );
      }
    }
  }

  return jsDoc;
}

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
