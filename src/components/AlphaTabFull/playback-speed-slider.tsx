import * as alphaTab from '@coderline/alphatab';
import React from 'react';
import { OverlayTrigger, Tooltip, Dropdown } from 'react-bootstrap';

export interface PlaybackSpeedSliderProps {
    api: alphaTab.AlphaTabApi;
}

export interface PlaybackSpeedSliderState {
    speed: number;
}

export class PlaybackSpeedSlider extends React.Component<PlaybackSpeedSliderProps, PlaybackSpeedSliderState> {
    public constructor(props: PlaybackSpeedSliderProps) {
        super(props);
        this.state = {
            speed: 1
        };
        this.setSpeed = this.setSpeed.bind(this);
    }

    private setSpeed(speed: number, e: React.MouseEvent) {
        e.preventDefault();
        const api = this.props.api;
        if (api) {
            this.setState({
                speed: speed,
            });
            this.props.api.playbackSpeed = speed;
        }
    }

    public render() {
        return (
            <OverlayTrigger placement="bottom" overlay={<Tooltip>Playback Speed</Tooltip>}>
                <Dropdown drop="up">
                    <Dropdown.Toggle>
                        {this.state.speed}x
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                        <Dropdown.Item href="#" onClick={e => this.setSpeed(0.25, e)}>
                            0.25x
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setSpeed(0.5, e)}>
                            0.5x
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setSpeed(0.75, e)}>
                            0.75x
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setSpeed(0.9, e)}>
                            0.9x
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setSpeed(1, e)}>
                            1x
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setSpeed(1.25, e)}>
                            1.25x
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setSpeed(1.5, e)}>
                            1.5x
                        </Dropdown.Item>
                        <Dropdown.Item href="#" onClick={e => this.setSpeed(2, e)}>
                            2x
                        </Dropdown.Item>
                    </Dropdown.Menu>
                </Dropdown>
            </OverlayTrigger>

        );
    }
}