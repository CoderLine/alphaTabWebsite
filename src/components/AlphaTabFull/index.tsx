import * as alphaTab from '@coderline/alphatab';
import React from 'react';
import { PlayerControlsGroup } from './player-controls-group';
import { TrackItem } from './track-item';
import styles from './styles.module.scss';

interface AlphaTabProps {
    settings: any
}

interface AlphaTabState {
    settings: alphaTab.Settings,
    isLoading: boolean,
    api?: alphaTab.AlphaTabApi,
    score?: alphaTab.model.Score;
    selectedTracks?: Map<number, alphaTab.model.Track>;
}

export class AlphaTabFull extends React.Component<AlphaTabProps, AlphaTabState>  {
    private _currentTempo: number = 0;
    private _viewPort: React.RefObject<HTMLDivElement>;
    private _alphaTab: React.RefObject<HTMLDivElement>;
    private _wrapper: React.RefObject<HTMLDivElement>;
    private _playerControls: React.RefObject<PlayerControlsGroup>;

    constructor(props: AlphaTabProps | Readonly<AlphaTabProps>) {
        super(props);
        this._viewPort = React.createRef();
        this._alphaTab = React.createRef();
        this._wrapper = React.createRef();
        this._playerControls = React.createRef();

        // pull fonts
        const settings = new alphaTab.Settings();
        settings.player.scrollOffsetY = -10;
        settings.player.enablePlayer = true;
        settings.player.soundFont = require('@coderline/alphatab/soundfont/sonivox.sf2');
        settings.fillFromJson(props.settings);

        this.state = {
            settings: settings,
            isLoading: true
        };
    }

    componentDidMount(): void {
        this.state.settings.player.scrollElement = this._viewPort.current as any;
        this.setupEvents();

        this.setState({
            api: new alphaTab.AlphaTabApi(this._alphaTab.current, this.state.settings)
        });
        this._wrapper.current.ondragover = (e) => {
            e.stopPropagation();
            e.preventDefault();
            e.dataTransfer.dropEffect = 'link';
        };
        this._wrapper.current.ondrop = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length === 1) {
                this._playerControls.current.openFile(files[0]);
            }
        };
    }

    componentWillUnmount(): void {
        this.state.api?.destroy();
    }

    private updateMasterBarTimes(currentMasterBar: alphaTab.model.MasterBar) {
        const masterBarCount = currentMasterBar.score.masterBars.length;
        if (currentMasterBar.tempoAutomation != null) {
            this._currentTempo = currentMasterBar.tempoAutomation.value | 0;
        }

        this._playerControls.current.setState({
            timeSignatureNumerator: currentMasterBar.timeSignatureNumerator,
            timeSignatureDenominator: currentMasterBar.timeSignatureDenominator,
            currentBarIndex: currentMasterBar.index + 1,
            totalBarCount: masterBarCount,
            tempo: this._currentTempo,
        });
    }

    private setupEvents() {
        const at = this._alphaTab.current;
        const playerControls = this._playerControls.current;

        at.addEventListener("alphaTab.scoreLoaded", (e: CustomEvent) => {
            this.setState({
                score: e.detail,
            });
            this._currentTempo = e.detail.tempo;
            this.updateMasterBarTimes(e.detail.masterBars[0]);
        });

        at.addEventListener("alphaTab.playedBeatChanged", (e: CustomEvent) => {
            this.updateMasterBarTimes(e.detail.voice.bar.masterBar);
        });

        at.addEventListener("alphaTab.playerStateChanged", (e: CustomEvent) => {
            const args = e.detail;
            playerControls.setState({
                isPlaying: args.state == 1,
            });
        });

        at.addEventListener("alphaTab.resize", (e: CustomEvent) => {
            if (e.detail.newWidth > 750) {
                e.detail.settings.display.scale = 1;
                e.detail.settings.display.layoutMode = alphaTab.LayoutMode.Page;
            } else {
                e.detail.settings.display.scale = 0.8;
                e.detail.settings.display.layoutMode = alphaTab.LayoutMode.Horizontal;
            }
        });

        at.addEventListener("alphaTab.renderStarted", (e: CustomEvent) => {
            const isResize = e.detail;
            const selectedTracks = new Map();
            this.state.api.tracks.forEach((t) => {
                selectedTracks.set(t.index, t);
            });
            this.setState({
                selectedTracks: selectedTracks,
                isLoading: !isResize,
            });
        });

        at.addEventListener("alphaTab.renderFinished", () => {
            this.setState({
                isLoading: false,
            });
        });

        let previousTime = -1;
        let previousEndTime = 0;
        at.addEventListener("alphaTab.playerPositionChanged", (e: CustomEvent) => {
            const args = e.detail;

            // reduce number of UI updates to second changes.
            const currentSeconds = (args.currentTime / 1000) | 0;
            if (args.endTick == previousEndTime &&
                (currentSeconds == previousTime || currentSeconds === 0)) {
                return;
            }
            previousTime = currentSeconds;
            playerControls.setState(args);
        });

        at.addEventListener("alphaTab.soundFontLoad", function (e: CustomEvent) {
            playerControls.setState({
                soundFontLoadPercentage: e.detail.loaded / e.detail.total,
            });
        });
        at.addEventListener("alphaTab.soundFontLoaded", function (e) {
            playerControls.setState({
                soundFontLoadPercentage: 1,
            });
        });
    }

    public render(): JSX.Element {
        return (
            <div className={styles['at-wrap']} ref={this._wrapper}>
                {this.state.isLoading && (
                    <div className={styles['at-overlay']}>
                        <div className={styles['at-overlay-content']}>
                            <div
                                className={styles['spinner-border']}
                                style={{ width: "3rem", height: "3rem" }}
                                role="status"
                            ></div>
                        </div>
                    </div>
                )}

                <div className={styles['at-content']}>
                    <div className={styles['at-sidebar']}>
                        <div className={styles['at-sidebar-content']}>
                            <div className={styles['at-track-list']}>
                                {this.state.score?.tracks.map((t) => (
                                    <TrackItem
                                        key={t.index}
                                        api={this.state.api}
                                        isSelected={this.state.selectedTracks?.has(t.index)}
                                        track={t}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className={styles['at-viewport']} ref={this._viewPort}>
                        <div className={styles['at-canvas']} ref={this._alphaTab}></div>
                    </div>
                </div>

                <div className={styles['at-footer']}>
                    <PlayerControlsGroup ref={this._playerControls} api={this.state.api} />
                </div>
            </div>
        );
    }
}