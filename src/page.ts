export class Page {
  constructor(private pageMeta: any) {}

  public prop<T>(key: string, defaultValue: T): T {
    if (this.pageMeta.type === "link") {
      if (key === "link") {
        return this.pageMeta.href as T;
      } else if (key === "title") {
        return this.pageMeta.label as T;
      }
    }

    if('customProps' in this.pageMeta && this.pageMeta.customProps) {
      if (key in this.pageMeta.customProps) {
        return this.pageMeta.customProps[key] as T;
      }
    }

    if('frontMatter' in this.pageMeta && this.pageMeta.frontMatter) {
      if ('sidebar_custom_props' in this.pageMeta.frontMatter &&
          key in this.pageMeta.frontMatter.sidebar_custom_props) {
        return this.pageMeta.frontMatter.sidebar_custom_props[key] as T;
      }
      if (key in this.pageMeta.frontMatter) {
        return this.pageMeta.frontMatter[key] as T;
      }
    }
    
    return defaultValue;
  }

  public props(key: string) {
    const v = this.prop(key, "") ?? "";
    return v.split(";").filter((x) => x.length > 0);
  }
}
