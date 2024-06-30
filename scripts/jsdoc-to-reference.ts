import ts from "typescript";
import url from "url";
import path from "path";
import fs from "fs";
import { generateSettingsPages } from "./jsdoc-to-settings";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

function reformatDocs(code: string): string {
  // https://github.com/microsoft/TypeScript/issues/15749

  code = code.replace(
    /([ \t]+)\* @example[ ]+([^\r\n]+)/g,
    "$1* @example\n$1* $2"
  );

  return code;
}

function createDiagnosticReporter(pretty?: boolean): ts.DiagnosticReporter {
  const host: ts.FormatDiagnosticsHost = {
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getNewLine: () => ts.sys.newLine,
    getCanonicalFileName: ts.sys.useCaseSensitiveFileNames
      ? (x) => x
      : (x) => x.toLowerCase(),
  };

  if (!pretty) {
    return (diagnostic) => ts.sys.write(ts.formatDiagnostic(diagnostic, host));
  }

  return (diagnostic) => {
    ts.sys.write(
      ts.formatDiagnosticsWithColorAndContext([diagnostic], host) +
        host.getNewLine()
    );
  };
}

function handleErrors(program: ts.Program) {
  let allDiagnostics: ts.Diagnostic[] = [];
  allDiagnostics = program.getConfigFileParsingDiagnostics().slice();
  const syntacticDiagnostics = program.getSyntacticDiagnostics();
  if (syntacticDiagnostics.length) {
    allDiagnostics.push(...syntacticDiagnostics);
  } else {
    allDiagnostics.push(...program.getOptionsDiagnostics());
    allDiagnostics.push(...program.getGlobalDiagnostics());
    allDiagnostics.push(...program.getSemanticDiagnostics());
  }

  program.getTypeChecker();

  const pretty = !!ts.sys.writeOutputIsTTY?.();
  let reportDiagnostic = createDiagnosticReporter();
  if (pretty) {
    reportDiagnostic = createDiagnosticReporter(true);
  }

  let diagnostics = ts.sortAndDeduplicateDiagnostics(allDiagnostics);
  let errorCount = 0;
  let warningCount = 0;
  for (const d of diagnostics) {
    switch (d.category) {
      case ts.DiagnosticCategory.Error:
        errorCount++;
        break;
      case ts.DiagnosticCategory.Warning:
        warningCount++;
        break;
    }
    reportDiagnostic(d);
  }

  if (pretty) {
    reportDiagnostic({
      file: undefined,
      start: undefined,
      length: undefined,
      code: 6194,
      messageText: `Compilation completed with ${errorCount} errors and ${warningCount} warnings${ts.sys.newLine}`,
      category:
        errorCount > 0
          ? ts.DiagnosticCategory.Error
          : warningCount > 0
          ? ts.DiagnosticCategory.Warning
          : ts.DiagnosticCategory.Message,
    });
  }

  if (errorCount > 0) {
    ts.sys.exit(ts.ExitStatus.DiagnosticsPresent_OutputsGenerated);
  }
}

async function collectTypes(): Promise<
  [Map<string, ts.DeclarationStatement>, ts.Program]
> {
  const dts = path.join(
    __dirname,
    "..",
    "node_modules",
    "@coderline",
    "alphatab",
    "dist",
    "alphaTab.d.ts"
  );

  console.log(`Reading types from ${dts}`);
  const dtsSource = reformatDocs(await fs.promises.readFile(dts, "utf-8"));
  const reformattedFile = dts + ".reformatted.d.ts";

  await fs.promises.writeFile(reformattedFile, dtsSource);

  const compilerOptions: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    module: ts.ModuleKind.NodeNext,
    target: ts.ScriptTarget.Latest,
  };

  const program = ts.createProgram({
    rootNames: [reformattedFile],
    options: compilerOptions,
    host: ts.createCompilerHost(compilerOptions, true),
  });

  program.getTypeChecker();

  const ast = program.getSourceFile(reformattedFile);

  handleErrors(program);

  const declarations = new Map<string, ts.DeclarationStatement>();

  for (const stmt of ast.statements) {
    switch (stmt.kind) {
      case ts.SyntaxKind.ClassDeclaration:
      case ts.SyntaxKind.EnumDeclaration:
      case ts.SyntaxKind.InterfaceDeclaration:
      case ts.SyntaxKind.TypeAliasDeclaration:
        const declaration = stmt as ts.DeclarationStatement;
        if (declarations.has(declaration.name.text)) {
          console.warn("Duplicate declaration of ", declaration.name.text);
        }
        declarations.set(declaration.name.text, declaration);
        break;
    }
  }

  console.log(`${declarations.size} types loaded`);

  return [declarations, program];
}

async function run() {
  const [declarations, program] = await collectTypes();

  await generateSettingsPages(program, declarations);
}

run();
