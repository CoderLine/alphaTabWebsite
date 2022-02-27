import { PropSidebarItem } from '@docusaurus/plugin-content-docs/src/sidebars/types';

export class Page {
  constructor(private pageMeta: PropSidebarItem) {}

  public prop<T>(key: string, defaultValue: T): T {
    if(this.pageMeta.type === 'link') {
      if(key === 'link'){
        return this.pageMeta.href as any as T;
      } else if(key === 'label') {
        return this.pageMeta.label as any as T;
      }
    }
    if (this.pageMeta.customProps && key in this.pageMeta.customProps) {
      return this.pageMeta.customProps[key] as T /* TODO */;
    }
    return defaultValue;
  }

  public props(key: string) {
    const v = this.prop(key, "") ?? "";
    return v.split(";").filter((x) => x.length > 0);
  }
}
