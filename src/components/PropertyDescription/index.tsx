import { buildNames } from "@site/src/names";
import { Page } from "@site/src/page";
import React from 'react';
import { CodeBadge } from "../CodeBadge";

export class PropertyDescription extends React.Component<{ metadata: any }>
{
    public render() {
        const page = new Page(this.props.metadata);
        const { jsNames, csNames, domNames } = buildNames(page);
        return (
            <table className="table table-striped table-condensed type-table">
                <tbody>
                    {jsNames.map(n => (
                        <tr>
                            <td><CodeBadge type="js" name={n} /></td>
                        </tr>
                    ))}
                    {jsNames.map(n => (
                        <tr>
                            <td><CodeBadge type="json" name={n} /></td>
                        </tr>
                    ))}
                    {domNames.map(n => (
                        <tr>
                            <td><CodeBadge type="html" name={n} /></td>
                        </tr>
                    ))}
                    {csNames.map(n => (
                        <tr>
                            <td><CodeBadge type="net" name={n} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }
}