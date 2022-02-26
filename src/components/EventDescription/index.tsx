import { Page } from '@site/src/page';
import React from 'react';
import { CodeBadge } from '../CodeBadge';

export interface EventDescriptionProps {
    metadata: any;
}

export class EventDescription extends React.Component<EventDescriptionProps> {
    public constructor(props: EventDescriptionProps) {
        super(props);
    }

    public render() {
        const page = new Page(this.props.metadata);
        const dotNetName = page.prop("title", "");
        const jsNames = page.props("jsName");
        const domNames = page.props("domName");
        return (
            <table className="table table-striped table-condensed type-table" >
                <tbody>
                    <tr>
                        <td><CodeBadge type="net" name={dotNetName} /></td>
                    </tr>
                    {jsNames.map((name, index) => (
                        <tr key={index}>
                            <td><CodeBadge type="js" name={name} /></td>
                        </tr>
                    ))}
                    {domNames.map((name, index) => (
                        <tr key={index}>
                            <td><CodeBadge type="html" name={name} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }
}