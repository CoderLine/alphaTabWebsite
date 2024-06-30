import { Page } from "./page";

export function toPascalCase(v: string | string[]) {
  if (typeof v === "string") {
    var parts = v.split(".");
    for (let i = 0; i < parts.length; i++) {
      parts[i] = parts[i].slice(0, 1).toUpperCase() + parts[i].slice(1);
    }
    return parts.join(".");
  }
  return v.map(toPascalCase);
}

export function toCamelCase(v: string | string[]) {
  if (typeof v === "string") {
    var parts = v.split(".");
    for (let i = 0; i < parts.length; i++) {
      parts[i] = parts[i];
    }
    return parts.join(".");
  }
  return v.map(toCamelCase);
}

export function toDomSettingNames(jsNames: string[], wildCard: boolean) {
  return jsNames.map((v) => {
    const parts = v.split(".");
    if (wildCard) {
      parts.push("*");
    }

    let domName = "data";
    for (const part of parts) {
      domName += `-${part.toLowerCase()}`;
    }

    return domName;
  });
}

export function toDomEventNames(jsNames: string[]) {
  return jsNames.map((v) => {
    return `alphaTab.${v}`;
  });
}

export function tojQueryEventNames(jsNames: string[]) {
  return jsNames.map((v) => {
    return `alphaTab.${v}`;
  });
}

export function tojQueryMethodNames(jsNames: string[]) {
  return jsNames.map((v) => {
    return `alphaTab('${v}')`;
  });
}

export function tojQueryPropertyNames(jsNames: string[]) {
  return jsNames.map((v) => {
    return `alphaTab('${v}')`;
  });
}

export function buildNames(property: Page) {
  const javaScriptOnly = property.prop("javaScriptOnly", false);
  const jQueryOnly = property.prop("jQueryOnly", false);
  const category = property.prop("category", "");

  let jsNames = jQueryOnly ? [] : property.props("title");

  let csNames = property.props("csName");
  if (!javaScriptOnly && csNames.length === 0) {
    csNames = toPascalCase(jsNames);
  }

  let androidNames = property.props("androidName");
  if (!javaScriptOnly && androidNames.length === 0) {
    androidNames = toCamelCase(jsNames);
  }

  if (property.prop("jsOnParent", false) && jsNames.length > 0) {
    jsNames.push(jsNames[0].split(".")[1]);
  }

  let jQueryNames = property.props("jQueryName");
  if (property.prop("jQuery", true) && jQueryNames.length === 0) {
    if (category.startsWith("Events")) {
      jQueryNames = tojQueryEventNames(jsNames);
    } else if (category.startsWith("Methods")) {
      jQueryNames = tojQueryMethodNames(jsNames);
    } else if (category.startsWith("Properties")) {
      jQueryNames = tojQueryPropertyNames(jsNames);
    } else if (property.prop("jQuery", false)) {
      jQueryNames = jsNames;
    }
  }

  if (category.startsWith("Methods")) {
    jsNames = jsNames.map((v) => `${v}()`);
    csNames = csNames.map((v) => `${v}()`);
    androidNames = androidNames.map((v) => `${v}()`);
  }

  return {
    jsNames,
    csNames,
    jQueryNames,
    androidNames
  };
}
