import ts from "typescript";
import path from "node:path";
import url from "node:url";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

export type TypeWithNullableInfo = {
  readonly isNullable: boolean;
  readonly isOptional: boolean;
  readonly isUnionType: boolean;
  readonly isPrimitiveType: boolean;
  readonly isEnumType: boolean;
  readonly isOwnType: boolean;
  readonly isTypedArray: boolean;
  readonly typeAsString: string;
  readonly modulePath: string;
  readonly isCloneable: boolean;
  readonly isJsonImmutable: boolean;
  readonly isNumberType: boolean;
  readonly isMap: boolean;
  readonly isSet: boolean;
  readonly isArray: boolean;
  readonly arrayItemType?: TypeWithNullableInfo;
  readonly typeArguments?: readonly TypeWithNullableInfo[];
  readonly unionTypes?: readonly TypeWithNullableInfo[];
  readonly jsDocTags?: readonly ts.JSDocTag[];
};

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

function findModule(type: ts.Type, options: ts.CompilerOptions) {
  if (type.symbol && type.symbol.declarations) {
    for (const decl of type.symbol.declarations) {
      const file = decl.getSourceFile();
      if (file) {
        const relative = path.relative(
          path.resolve(__dirname, '..'),
          path.resolve(file.fileName)
        );
        return relative;
      }
    }

    return "./" + type.symbol.name;
  }

  return "";
}

export function getTypeWithNullableInfo(
  program: ts.Program,
  node: ts.TypeNode | ts.Type,
  allowUnion: boolean,
  isOptionalFromDeclaration: boolean,
  typeArgumentMapping: Map<string, ts.Type> | undefined
): TypeWithNullableInfo {
  const checker = program.getTypeChecker();

  let typeInfo: Writeable<TypeWithNullableInfo> = {
    isNullable: false,
    isOptional: isOptionalFromDeclaration,
    isUnionType: false,
    isPrimitiveType: false,
    isEnumType: false,
    isTypedArray: false,
    isOwnType: false,
    typeAsString: "",
    modulePath: "",
    isJsonImmutable: false,
    isNumberType: false,
    isMap: false,
    isSet: false,
    isArray: false,
    isCloneable: false,
  };
  let mainType: ts.Type | undefined;

  const fillBaseInfoFrom = (tsType: ts.Type) => {
    const valueDeclaration = tsType.symbol?.valueDeclaration;
    mainType = tsType;

    typeInfo.typeAsString = checker.typeToString(tsType, undefined, undefined);
    typeInfo.modulePath = findModule(tsType, program.getCompilerOptions());
    typeInfo.isOwnType =
      !!typeInfo.modulePath &&
      typeInfo.modulePath.includes("@coderline") &&
      typeInfo.modulePath.includes("alphatab") &&
      !!valueDeclaration;

    if (isEnumType(tsType)) {
      typeInfo.isEnumType = true;
    } else if (isPrimitiveType(tsType)) {
      typeInfo.isNumberType = isNumberType(tsType);
      typeInfo.isPrimitiveType = true;
    } else if (typeInfo.isOwnType) {
      typeInfo.jsDocTags = valueDeclaration
        ? ts.getJSDocTags(valueDeclaration)
        : undefined;
      if (typeInfo.jsDocTags) {
        typeInfo.isJsonImmutable = !!typeInfo.jsDocTags.find(
          (t) => t.tagName.text === "json_immutable"
        );
        typeInfo.isCloneable = !!typeInfo.jsDocTags.find(
          (t) => t.tagName.text === "cloneable"
        );
      }

      if (tsType.flags & ts.ObjectFlags.Reference) {
        typeInfo.typeArguments = (
          tsType as ts.TypeReference
        ).typeArguments?.map((p) =>
          getTypeWithNullableInfo(
            program,
            p,
            allowUnion,
            false,
            typeArgumentMapping
          )
        );
      }
    } else if (checker.isArrayType(tsType)) {
      typeInfo.isArray = true;
      typeInfo.arrayItemType = getTypeWithNullableInfo(
        program,
        (tsType as ts.TypeReference).typeArguments![0],
        allowUnion,
        false,
        typeArgumentMapping
      );
    } else if (tsType.symbol) {
      typeInfo.typeAsString = tsType.symbol.name;
      switch (tsType.symbol.name) {
        case "Uint8Array":
        case "Uint16Array":
        case "Uint32Array":
        case "Int8Array":
        case "Int16Array":
        case "Int32Array":
        case "Float32Array":
        case "Float64Array":
          typeInfo.isTypedArray = true;
          typeInfo.arrayItemType = {
            isNullable: false,
            isOptional: false,
            isUnionType: false,
            isPrimitiveType: true,
            isEnumType: false,
            isOwnType: false,
            isTypedArray: false,
            typeAsString: "number",
            modulePath: "",
            isCloneable: false,
            isJsonImmutable: false,
            isNumberType: true,
            isMap: false,
            isSet: false,
            isArray: false,
          };
          break;
        case "Map":
          typeInfo.isMap = true;
          typeInfo.typeArguments = (
            tsType as ts.TypeReference
          ).typeArguments!.map((p) =>
            getTypeWithNullableInfo(
              program,
              p,
              allowUnion,
              false,
              typeArgumentMapping
            )
          );
          break;
        case "Set":
          typeInfo.isSet = true;
          typeInfo.typeArguments = (
            tsType as ts.TypeReference
          ).typeArguments!.map((p) =>
            getTypeWithNullableInfo(
              program,
              p,
              allowUnion,
              false,
              typeArgumentMapping
            )
          );
          break;
        default:
          if (tsType.isTypeParameter()) {
            if (typeArgumentMapping?.has(typeInfo.typeAsString)) {
              typeInfo = getTypeWithNullableInfo(
                program,
                typeArgumentMapping.get(typeInfo.typeAsString)!,
                allowUnion,
                false,
                typeArgumentMapping
              );
            } else {
              throw new Error(
                "Unresolved type parameters " + typeInfo.typeAsString
              );
            }
          } else if ((tsType as ts.Type).flags & ts.ObjectFlags.Reference) {
            typeInfo.typeArguments = (
              tsType as ts.TypeReference
            ).typeArguments?.map((p) =>
              getTypeWithNullableInfo(
                program,
                p,
                allowUnion,
                false,
                typeArgumentMapping
              )
            );
          }
          break;
      }
    }
  };

  if ("kind" in node) {
    if (ts.isUnionTypeNode(node)) {
      for (const t of node.types) {
        if (t.kind === ts.SyntaxKind.NullKeyword) {
          typeInfo.isNullable = true;
        } else if (
          ts.isLiteralTypeNode(t) &&
          t.literal.kind === ts.SyntaxKind.NullKeyword
        ) {
          typeInfo.isNullable = true;
        } else if (t.kind === ts.SyntaxKind.UndefinedKeyword) {
          typeInfo.isOptional = true;
        } else if (
          ts.isLiteralTypeNode(t) &&
          t.literal.kind === ts.SyntaxKind.UndefinedKeyword
        ) {
          typeInfo.isOptional = true;
        } else if (!mainType) {
          mainType = checker.getTypeFromTypeNode(t);
        } else if (allowUnion) {
          if (!typeInfo.unionTypes) {
            typeInfo.unionTypes = [
              getTypeWithNullableInfo(
                program,
                mainType,
                false,
                false,
                typeArgumentMapping
              ),
            ];
          }

          (typeInfo.unionTypes as TypeWithNullableInfo[]).push(
            getTypeWithNullableInfo(
              program,
              t,
              false,
              false,
              typeArgumentMapping
            )
          );
        } else {
          throw new Error(
            "Multi union types on not supported at this location: " +
              node.getSourceFile().fileName +
              ":" +
              node.getText()
          );
        }
      }

      if (!typeInfo.unionTypes && mainType) {
        fillBaseInfoFrom(mainType);
      }
    } else {
      fillBaseInfoFrom(checker.getTypeFromTypeNode(node));
    }
  } else {
    // use typeArgumentMapping
    if (isPrimitiveType(node) || isEnumType(node)) {
      fillBaseInfoFrom(node);
    } else if (node.isUnion()) {
      for (const t of node.types) {
        if ((t.flags & ts.TypeFlags.Null) !== 0) {
          typeInfo.isNullable = true;
        } else if ((t.flags & ts.TypeFlags.Undefined) !== 0) {
          typeInfo.isOptional = true;
        } else if (!mainType) {
          fillBaseInfoFrom(t);
        } else if (allowUnion) {
          typeInfo.unionTypes ??= [];
          (typeInfo.unionTypes as TypeWithNullableInfo[]).push(
            getTypeWithNullableInfo(
              program,
              t,
              false,
              false,
              typeArgumentMapping
            )
          );
        } else {
          throw new Error(
            "Multi union types on not supported at this location: " +
              typeInfo.typeAsString
          );
        }
      }
    } else {
      fillBaseInfoFrom(node);
    }
  }

  return typeInfo;
}

export function isEnumType(type: ts.Type) {
  // if for some reason this returns true...
  if (hasFlag(type, ts.TypeFlags.Enum)) return true;
  // it's not an enum type if it's an enum literal type
  if (hasFlag(type, ts.TypeFlags.EnumLiteral)) return true;
  // get the symbol and check if its value declaration is an enum declaration
  const symbol = type.getSymbol();
  if (!symbol) return false;
  const { valueDeclaration } = symbol;

  return (
    valueDeclaration && valueDeclaration.kind === ts.SyntaxKind.EnumDeclaration
  );
}

export function hasFlag(type: ts.Type, flag: ts.TypeFlags): boolean {
  return (type.flags & flag) === flag;
}

export function isPrimitiveType(type: ts.Type | null) {
  if (!type) {
    return false;
  }

  if (hasFlag(type, ts.TypeFlags.Number)) {
    return true;
  }
  if (hasFlag(type, ts.TypeFlags.String)) {
    return true;
  }
  if (hasFlag(type, ts.TypeFlags.Boolean)) {
    return true;
  }
  if (hasFlag(type, ts.TypeFlags.BigInt)) {
    return true;
  }
  if (hasFlag(type, ts.TypeFlags.Unknown)) {
    return true;
  }

  return false;
}

export function isNumberType(type: ts.Type | null) {
  if (!type) {
    return false;
  }

  if (hasFlag(type, ts.TypeFlags.Number)) {
    return true;
  }

  return false;
}
