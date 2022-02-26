import * as alphaTab from '@coderline/alphatab';
import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { solid } from '@fortawesome/fontawesome-svg-core/import.macro'
import { OverlayTrigger, Tooltip, Dropdown } from 'react-bootstrap';

export interface ZoomLevelSelectorProps {
    api: alphaTab.AlphaTabApi;
}

export interface ZoomLevelSelectorState {
    zoom: number;
}

export class ZoomLevelSelector extends React.Component<ZoomLevelSelectorProps, ZoomLevelSelectorState> {
    public constructor(props: ZoomLevelSelectorProps) {
        super(props);
        this.state = {
            zoom: 100
        };
        this.setZoom = this.setZoom.bind(this);
    }

    public setZoom(zoom: number, e: React.MouseEvent) {
        e.preventDefault();
        const api = this.props.api;
        if (api) {
            this.setState({
                zoom: zoom,
            });

            api.settings.display.scale = zoom / 100.0;
            api.updateSettings();
            api.render();
        }
    }

    render() {
        return (
            <OverlayTrigger placement="bottom" overlay={<Tooltip>Zoom Level</Tooltip>}>

                <Dropdown drop="up">
                    <Dropdown.Toggle>
                        <FontAwesomeIcon icon={solid('search')}></FontAwesomeIcon>
                        {this.state.zoom}%
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                        <Dropdown.Item href="#" onClick={e => this.setZoom(25, e)}>
                            25%
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setZoom(50, e)}>
                            50%
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setZoom(75, e)}>
                            75%
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setZoom(90, e)}>
                            90%
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setZoom(100, e)}>
                            100%
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setZoom(110, e)}>
                            110%
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setZoom(125, e)}>
                            125%
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setZoom(150, e)}>
                            150%
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setZoom(200, e)}>
                            200%
                        </Dropdown.Item>
                    </Dropdown.Menu>
                </Dropdown>
            </OverlayTrigger>
        );
    }
}
