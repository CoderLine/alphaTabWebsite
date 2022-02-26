import * as alphaTab from '@coderline/alphatab';
import React from 'react';
import styles from './styles.module.scss';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { solid, regular } from '@fortawesome/fontawesome-svg-core/import.macro'
import Dropdown from 'react-bootstrap/esm/Dropdown';

export interface LayoutSelectorProps {
    api: alphaTab.AlphaTabApi;
}

export interface LayoutSelectorState {
}

export class LayoutSelector extends React.Component<LayoutSelectorProps, LayoutSelectorState> {
    public constructor(props: LayoutSelectorProps) {
        super(props);
        this.selectLayout = this.selectLayout.bind(this);
    }

    public selectLayout(layoutMode: alphaTab.LayoutMode, scrollMode: alphaTab.ScrollMode, e: React.MouseEvent) {
        e.preventDefault();

        if (this.props.api) {
            const settings = this.props.api.settings;
            console.log(settings);
            settings.display.layoutMode = layoutMode;
            settings.player.scrollMode = scrollMode;
            this.props.api.updateSettings();
            this.props.api.render();
        }
    }

    public render() {
        return (
            <Dropdown drop="up">
                <Dropdown.Toggle>
                    Layout
                </Dropdown.Toggle>
                <Dropdown.Menu>
                    <Dropdown.Item href="#" onClick={e => this.selectLayout(alphaTab.LayoutMode.Horizontal, alphaTab.ScrollMode.OffScreen, e)}>
                        <FontAwesomeIcon icon={regular('caret-square-right')}></FontAwesomeIcon>
                        Horizontal Layout (Off-Screen)
                    </Dropdown.Item>
                    <Dropdown.Item href="#" onClick={e => this.selectLayout(alphaTab.LayoutMode.Horizontal, alphaTab.ScrollMode.OffScreen, e)}>
                        <FontAwesomeIcon icon={solid('caret-square-right')}></FontAwesomeIcon>
                        Horizontal Layout (Bar-Wise)
                    </Dropdown.Item>
                    <Dropdown.Item href="#" onClick={e => this.selectLayout(alphaTab.LayoutMode.Page, alphaTab.ScrollMode.Continuous, e)}>
                        <FontAwesomeIcon icon={solid('caret-square-down')}></FontAwesomeIcon>
                        Vertical Layout
                    </Dropdown.Item>
                </Dropdown.Menu>
            </Dropdown>
        );
    }
}
