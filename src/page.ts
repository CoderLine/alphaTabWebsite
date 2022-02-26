export class Page {
  constructor(private pageMeta: any) {}

  public prop<T>(key: string, defaultValue?: T): T {
    if (key in this.pageMeta) {
      return this.pageMeta[key];
    }
    return defaultValue;
  }

  public props(key: string) {
    const v = this.prop(key, "") || "";
    return v.split(";").filter((x) => x.length > 0);
  }
}
