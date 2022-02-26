import * as alphaTab from '@coderline/alphatab';
import React from 'react';
import { LayoutSelector } from './layout-selector';
import { PlaybackSpeedSlider } from './playback-speed-slider';
import { PlayerProgressIndicator } from './player-progress-indicator';
import { ScoreDetails } from './score-details';
import { ZoomLevelSelector } from './zoom-level-selector';
import styles from './styles.module.scss';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { solid } from '@fortawesome/fontawesome-svg-core/import.macro'
import { OverlayTrigger, Tooltip } from 'react-bootstrap';

export interface PlayerControlsGroupProps {
    api: alphaTab.AlphaTabApi;
}

export interface PlayerControlsGroupState {
    soundFontLoadPercentage: number;
    isLooping: boolean;
    isCountInActive: boolean;
    isMetronomeActive: boolean;
    isPlaying: boolean;

    tempo: number;

    currentBarIndex: number;
    totalBarCount: number;

    timeSignatureNumerator: number;
    timeSignatureDenominator: number;

    currentTime: number;
    endTime: number;
}

export class PlayerControlsGroup extends React.Component<PlayerControlsGroupProps, PlayerControlsGroupState> {
    public constructor(props: PlayerControlsGroupProps) {
        super(props);
        this.state = {
            soundFontLoadPercentage: 0,
            isLooping: false,
            isCountInActive: false,
            isMetronomeActive: false,
            isPlaying: false,
            currentTime: 0,
            endTime: 1,
            tempo: 0,
            currentBarIndex: 0,
            totalBarCount: 0,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4
        };
    }

    public stop(e: Event) {
        e.preventDefault();
        this.props.api?.stop();
    }

    public playPause(e: Event) {
        e.preventDefault();
        this.props.api?.playPause();
    }

    public print(e: Event) {
        e.preventDefault();
        this.props.api?.print('');
    }

    public download(e: Event) {
        e.preventDefault();
        const exporter = new alphaTab.exporter.Gp7Exporter();
        const score = this.props.api.score;
        const data = exporter.export(score, this.props.api.settings);
        const a = document.createElement('a');
        a.download = score.title.length > 0 ? score.title.trim() + '.gp' : 'Untitled.gp';
        a.href = URL.createObjectURL(new Blob([data], { type: 'application/gp' }));
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    public open(e: Event) {
        e.preventDefault();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = ".gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.mxml,.xml,.capx";
        input.onchange = () => {
            if (input.files.length === 1) {
                this.openFile(input.files[0]);
            }
        };
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    public openFile(file: Blob) {
        const reader = new FileReader();
        reader.onload = (data) => {
            this.props.api.load(data.target.result, [0]);
        };
        reader.readAsArrayBuffer(file);
    }

    public toggleLoop(e: Event) {
        e.preventDefault();
        if (this.props.api) {
            let isLooping = !this.state.isLooping;
            this.setState({
                isLooping: isLooping,
            });
            this.props.api.isLooping = isLooping;
        }
    }

    public toggleMetronome(e: Event) {
        e.preventDefault();
        if (this.props.api) {
            let isMetronomeActive = !this.state.isMetronomeActive;
            this.setState({
                isMetronomeActive: isMetronomeActive,
            });
            this.props.api.metronomeVolume = isMetronomeActive ? 1 : 0;
        }
    }

    public toggleCountIn(e: Event) {
        e.preventDefault();
        if (this.props.api) {
            let isCountInActive = !this.state.isCountInActive;
            this.setState({
                isCountInActive: isCountInActive,
            });
            this.props.api.countInVolume = isCountInActive ? 1 : 0;
        }
    }

    public formatDuration(milliseconds: number) {
        let seconds = milliseconds / 1000;
        const minutes = (seconds / 60) | 0;
        seconds = (seconds - minutes * 60) | 0;
        return (
            String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0")
        );
    }

    public render(): JSX.Element {
        return (
            <>
                <div className={styles['at-time-slider']}>
                    <div
                        className={styles['at-time-slider-value']}
                        style={{
                            width:
                                ((this.state.currentTime / this.state.endTime) * 100).toFixed(
                                    2
                                ) + "%",
                        }}
                    ></div>
                </div>
                <div className={styles['at-player']}>
                    <div className={styles['at-player-left']}>
                        <OverlayTrigger placement="top" overlay={<Tooltip>Open File</Tooltip>}>
                            <a href="#" onClick={this.open.bind(this)}>
                                <FontAwesomeIcon icon={solid('folder-open')} />
                            </a>
                        </OverlayTrigger>

                        <OverlayTrigger placement="top" overlay={<Tooltip>Stop</Tooltip>}>
                            <a href="#" onClick={this.stop.bind(this)}
                                className={(this.props.api?.isReadyForPlayback ? "" : " disabled")}>
                                <FontAwesomeIcon icon={solid('step-backward')} />
                            </a>
                        </OverlayTrigger>


                        <OverlayTrigger placement="top" overlay={<Tooltip>Play/Pause</Tooltip>}>
                            <a href="#" onClick={this.playPause.bind(this)}
                                className={(this.props.api?.isReadyForPlayback ? "" : " disabled")}>
                                <FontAwesomeIcon icon={this.state.isPlaying ? solid("pause") : solid("play")} />
                            </a>
                        </OverlayTrigger>

                        <PlaybackSpeedSlider api={this.props.api} />
                        <PlayerProgressIndicator
                            percentage={this.state.soundFontLoadPercentage}
                        />
                        <ScoreDetails score={this.props.api?.score} />


                        <OverlayTrigger placement="top" overlay={<Tooltip>Time Position</Tooltip>}>
                            <div className={styles['at-time-position']}>
                                {this.formatDuration(this.state.currentTime)} /{" "}
                                {this.formatDuration(this.state.endTime)}
                            </div>
                        </OverlayTrigger>
                    </div>

                    <div className={styles['at-player-right']}>
                        <OverlayTrigger placement="top" overlay={<Tooltip>Count-In</Tooltip>}>
                            <a href="#"
                                onClick={this.toggleCountIn.bind(this)}
                                className={
                                    (this.props.api?.isReadyForPlayback ? "" : " disabled") +
                                    (this.state.isCountInActive ? " " + styles.active : "")
                                }
                            >
                                <FontAwesomeIcon icon={solid("hourglass-half")} />
                            </a>
                        </OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<Tooltip>Metronome</Tooltip>}>
                            <a
                                href="#"
                                onClick={this.toggleMetronome.bind(this)}
                                className={
                                    (this.props.api?.isReadyForPlayback ? "" : " disabled") +
                                    (this.state.isMetronomeActive ? " " + styles.active : "")
                                }
                            >
                                <FontAwesomeIcon icon={solid("edit")} />
                            </a>
                        </OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<Tooltip>Loop</Tooltip>}>
                            <a
                                href="#"
                                onClick={this.toggleLoop.bind(this)}
                                className={
                                    (this.props.api?.isReadyForPlayback ? "" : " disabled") +
                                    (this.state.isLooping ? " " + styles.active : "")
                                }
                            >
                                <FontAwesomeIcon icon={solid("retweet")} />
                            </a>
                        </OverlayTrigger>

                        <OverlayTrigger placement="top" overlay={<Tooltip>Print</Tooltip>}>
                            <a
                                href="#"
                                onClick={this.print.bind(this)}
                                className={
                                    (this.props.api?.isReadyForPlayback ? "" : " disabled")
                                }
                            >
                                <FontAwesomeIcon icon={solid("print")} />
                            </a>
                        </OverlayTrigger>

                        <OverlayTrigger placement="top" overlay={<Tooltip>Export to Guitar Pro 7</Tooltip>}>
                            <a
                                href="#"
                                onClick={this.download.bind(this)}
                                className={
                                    (this.props.api?.isReadyForPlayback ? "" : " disabled")
                                }
                            >
                                <FontAwesomeIcon icon={solid("download")} />
                            </a>
                        </OverlayTrigger>

                        <ZoomLevelSelector api={this.props.api} />
                        <LayoutSelector api={this.props.api} />

                        <div className={styles['at-logo']}>
                            powered by <img src="/img/alphatab.png" />
                        </div>
                    </div>
                </div>
            </>
        );
    }
}
