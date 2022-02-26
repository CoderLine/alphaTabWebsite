import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { Page } from '@site/src/page';
import { buildNames } from '@site/src/names';
import { CodeBadge } from '../CodeBadge';

function buildPropertyUrl(property: Page) {
    let url = '';
    if (property.prop('todo', false)) {
        url = "#todo";
    } else if (url = property.prop('link')) {
        url = useBaseUrl('docs/' + url);
    } else {
        url = useBaseUrl('docs/' + property.prop('id'));
    }
    return url;
}

class ReferenceRow extends React.Component<{ property: Page }> {
    public render() {
        const { jsNames, csNames, jQueryNames, domNames } = buildNames(this.props.property);
        return (
            <tr>
                <td>
                    <a href={buildPropertyUrl(this.props.property)}>
                        {jsNames.map(n => <CodeBadge type="js" name={n} />)}
                        {jQueryNames.length > 0 && <br />}
                        {jQueryNames.map(n => (<CodeBadge type="jquery" name={n} />))}
                        {domNames.length > 0 && <br />}
                        {domNames.map(n => (<CodeBadge type="html" name={n} />))}
                        {csNames.length > 0 && <br />}
                        {csNames.map(n => (<CodeBadge type="net" name={n} />))}
                    </a>
                </td>
                <td>{this.props.property.prop('description')}</td>
            </tr>
        )
    }
}

class ReferenceCategory extends React.Component<{ name: string, pages: Page[] }> {
    public render() {
        const rows = this.props.pages
            .sort((a, b) => {
                const ao = a.prop('order', 1000);
                const bo = b.prop('order', 1000);

                if (ao < bo) return -1;
                if (ao > bo) return 1;

                const at = a.prop('title', '');
                const bt = b.prop('title', '');

                if (at < bt) return -1;
                if (at > bt) return 1;

                return 0;
            })
            .map(p => (<ReferenceRow key={p.prop('id')} property={p} />));
        return (
            <>
                <tr>
                    <th colSpan={4}>{this.props.name}</th>
                </tr>
                {rows}
            </>
        );
    }
}

export class ReferenceTable extends React.Component<{ filter: string, type: string }> {
    public render() {
        // TODO: https://github.com/facebook/docusaurus/issues/6302
        const pages: { key: string, items: Page[] }[] = /*getPageList(filter)
            .filter(p => p.prop('showInTable', true))
            .groupBy(p => p.prop('category', ''))
            .orderBy(p => p.key)*/ [];
        const categories = pages
            .map(p => (<ReferenceCategory key={p.key} name={p.key} pages={p.items} />));
        return (
            <table className="table table-striped table-condensed reference-table" >
                <thead>
                    <tr>
                        <th>{this.props.type}</th>
                        <th>Summary</th>
                    </tr>
                </thead>
                <tbody>
                    {categories}
                </tbody>
            </table>
        )
    }
}