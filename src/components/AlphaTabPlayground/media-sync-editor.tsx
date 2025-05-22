'use client';

import * as alphaTab from '@coderline/alphatab';
import type React from 'react';
import styles from './styles.module.scss';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import * as solid from '@fortawesome/free-solid-svg-icons';
import * as brands from '@fortawesome/free-brands-svg-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import useResizeObserver from '@react-hook/resize-observer';
import { useAlphaTabEvent } from '@site/src/hooks';

// TODO: cleanup the code (splitup helpers and components properly)

export type MediaSyncEditorProps = {
    api: alphaTab.AlphaTabApi;
    score: alphaTab.model.Score;
};

enum SyncPointMarkerType {
    StartMarker = 0,
    EndMarker = 1,
    MasterBar = 2,
    Intermediate = 3
}

type SyncPointMarker = {
    syncTime: number;

    synthTime: number;
    synthBpm: number;
    synthTick: number;

    masterBarIndex: number;
    ratioPosition: number;
    occurence: number;
    modifiedTempo?: number;

    markerType: SyncPointMarkerType;
};

type SyncPointInfo = {
    endTick: number;
    endTime: number;
    sampleRate: number;
    leftSamples: Float32Array;
    rightSamples: Float32Array;
    syncPointMarkers: SyncPointMarker[];
};

function ticksToMilliseconds(tick: number, bpm: number): number {
    return (tick * 60000.0) / (bpm * 960);
}

async function buildSyncPointInfoFromApi(
    api: alphaTab.AlphaTabApi,
    createInitialSyncPoints: boolean
): Promise<SyncPointInfo> {
    const tickCache = api.tickCache;
    if (!tickCache || !api.score?.backingTrack?.rawAudioFile) {
        return {
            endTick: 0,
            endTime: 0,
            sampleRate: 0,
            leftSamples: new Float32Array(0),
            rightSamples: new Float32Array(0),
            syncPointMarkers: []
        };
    }

    const audioContext = new AudioContext();
    const buffer = await audioContext.decodeAudioData(api.score!.backingTrack!.rawAudioFile.buffer.slice(0));
    const rawSamples: Float32Array[] =
        buffer.numberOfChannels === 1
            ? [buffer.getChannelData(0), buffer.getChannelData(0)]
            : [buffer.getChannelData(0), buffer.getChannelData(1)];

    const sampleRate = audioContext.sampleRate;
    const endTime = (rawSamples[0].length / sampleRate) * 1000;

    await audioContext.close();

    const state: SyncPointInfo = {
        endTick: api.tickCache.masterBars.at(-1)!.end,
        syncPointMarkers: [],
        sampleRate,
        leftSamples: rawSamples[0],
        rightSamples: rawSamples[1],
        endTime
    };

    if (createInitialSyncPoints) {
        // create initial sync points for all tempo changes to ensure the song and the
        // backing track roughly align
        let synthBpm = api.tickCache!.masterBars[0].tempoChanges[0].tempo;
        let synthTimePosition = 0;
        let synthTickPosition = 0;

        const syncPoints: SyncPointMarker[] = [];

        // first create all changes not respecting the song start and end
        const occurences = new Map<number, number>();
        for (const masterBar of api.tickCache!.masterBars) {
            const occurence = occurences.get(masterBar.masterBar.index) ?? 0;
            occurences.set(masterBar.masterBar.index, occurence + 1);

            // we are guaranteed to have a tempo change per master bar indicating its own tempo
            // (even though its not a change)
            for (const changes of masterBar.tempoChanges) {
                const absoluteTick = changes.tick;
                const tickOffset = absoluteTick - synthTickPosition;
                if (tickOffset > 0) {
                    const timeOffset = ticksToMilliseconds(tickOffset, synthBpm);
                    synthTickPosition = absoluteTick;
                    synthTimePosition += timeOffset;
                }

                const marker: SyncPointMarker = {
                    markerType: SyncPointMarkerType.MasterBar,
                    masterBarIndex: masterBar.masterBar.index,
                    occurence,
                    syncTime: synthTimePosition,
                    synthBpm,
                    synthTime: synthTimePosition,
                    modifiedTempo: undefined,
                    ratioPosition: 0,
                    synthTick: synthTickPosition
                };

                if (masterBar.start === 0) {
                    marker.markerType = SyncPointMarkerType.StartMarker;
                } else if (changes.tick > masterBar.start) {
                    marker.markerType = SyncPointMarkerType.Intermediate;
                    const duration = masterBar.start - masterBar.end;
                    marker.ratioPosition = changes.tick / duration;
                }

                if (changes.tempo !== synthBpm || marker.markerType === SyncPointMarkerType.StartMarker) {
                    syncPoints.push(marker);
                    marker.modifiedTempo = changes.tempo;
                }

                synthBpm = changes.tempo;

                state.syncPointMarkers.push(marker);
            }

            const tickOffset = masterBar.end - synthTickPosition;
            const timeOffset = ticksToMilliseconds(tickOffset, synthBpm);
            synthTickPosition += tickOffset;
            synthTimePosition += timeOffset;
        }

        // end marker
        const lastMasterBar = api.tickCache!.masterBars.at(-1)!;
        state.syncPointMarkers.push({
            masterBarIndex: lastMasterBar.masterBar.index,
            occurence: occurences.get(lastMasterBar.masterBar.index)!,
            syncTime: synthTimePosition,
            synthTime: synthTimePosition,
            synthBpm,
            modifiedTempo: synthBpm,
            markerType: SyncPointMarkerType.EndMarker,
            ratioPosition: 1,
            synthTick: synthTickPosition
        });

        // with the final durations known, we can "squeeze" together the song
        // from start and end (keeping the relative positions)
        // and the other bars will be adjusted accordingly
        const [songStart, songEnd] = findAudioStartAndEnd(state);

        const synthDuration = synthTimePosition;
        const realDuration = songEnd - songStart;
        const scaleFactor = realDuration / synthDuration;

        // 1st Pass: shift all tempo change markers relatively and calculate BPM
        let syncTime = songStart;
        for (let i = 0; i < syncPoints.length; i++) {
            const syncPoint = syncPoints[i];

            syncPoint.syncTime = syncTime;

            if (i < 0) {
                const previousMarker = syncPoints[i - 1];
                const synthDuration = syncPoint.synthTime - previousMarker.synthTime;
                const syncedDuration = syncPoint.syncTime - previousMarker.syncTime;
                const newBpm = (synthDuration / syncedDuration) * previousMarker.synthBpm;
                previousMarker.modifiedTempo = newBpm;
            }

            const ownStart = syncPoint.synthTime;
            const nextStart = i < syncPoints.length - 1 ? syncPoints[i + 1].synthTime : ownStart;

            const oldDuration = nextStart - ownStart;
            const newDuration = oldDuration * scaleFactor;

            syncTime += newDuration;
        }

        // 2nd Pass: adjust all in-between markers according to the new position
        syncTime = songStart;
        let syncedBpm = syncPoints[0].modifiedTempo!;
        for (let i = 0; i < state.syncPointMarkers.length; i++) {
            const marker = state.syncPointMarkers[i];
            marker.syncTime = syncTime;

            if (marker.modifiedTempo) {
                syncedBpm = marker.modifiedTempo;
            }

            if (i < state.syncPointMarkers.length - 1) {
                const tickDiff = state.syncPointMarkers[i + 1].synthTick - marker.synthTick;
                syncTime += ticksToMilliseconds(tickDiff, syncedBpm);
            }
        }
    } else {
        state.syncPointMarkers = buildSyncPointMarkers(api);
    }

    return state;
}

function resetSyncPoints(api: alphaTab.AlphaTabApi, state: SyncPointInfo): SyncPointInfo {
    for (const b of api.score!.masterBars) {
        b.syncPoints = undefined;
    }

    return {
        ...state,
        syncPointMarkers: buildSyncPointMarkers(api)
    };
}

function findAudioStartAndEnd(state: SyncPointInfo): [number, number] {
    // once we have 1s non-silent audio we consider it as start (or inverted for end)
    const nonSilentSamplesThreshold = 1 * state.sampleRate;
    // we accept 200ms of silence inbetween audible samples
    const silentSamplesThreshold = 0.2 * state.sampleRate;
    // there can always be a bit of a noise. we require some amplitude
    // proper would be to consider the Frequency and calculate the
    const nonSilentAmplitudeThreshold = 0.001;

    // we limit the search to 10s (from start/end), proper audio should not exceed this
    const searchThreshold = Math.min(10 * state.sampleRate, state.leftSamples.length * 0.1);

    let songStart = searchThreshold;
    let songEnd = state.leftSamples.length - searchThreshold;

    // find start offset
    let sampleIndex = 0;

    let nonSilentSamplesInSection = 0;
    let silentSamplesInSequence = 0;
    let sectionStart = 0;

    while (sampleIndex < songStart) {
        if (
            Math.abs(state.leftSamples[sampleIndex]) >= nonSilentAmplitudeThreshold ||
            Math.abs(state.rightSamples[sampleIndex]) >= nonSilentAmplitudeThreshold
        ) {
            // the first audible sample marks the potential start
            if (nonSilentSamplesInSection === 0) {
                sectionStart = sampleIndex;
            }
            nonSilentSamplesInSection++;
            silentSamplesInSequence = 0;
        } else {
            silentSamplesInSequence++;
        }

        // found more than X-samples silent, no start until here
        if (silentSamplesInSequence > silentSamplesThreshold) {
            // reset and start searching agian
            sectionStart = sampleIndex + 1;
            nonSilentSamplesInSection = 0;
            silentSamplesInSequence = 0;
        }
        // found enough samples since section start which are audible, should be good
        else if (nonSilentSamplesInSection > nonSilentSamplesThreshold) {
            songStart = sectionStart;
            break;
        }

        sampleIndex++;
    }

    // and same from the back
    sampleIndex = state.leftSamples.length - 1;
    nonSilentSamplesInSection = 0;
    silentSamplesInSequence = 0;
    sectionStart = sampleIndex;

    while (sampleIndex >= songEnd) {
        if (
            Math.abs(state.leftSamples[sampleIndex]) >= nonSilentAmplitudeThreshold ||
            Math.abs(state.rightSamples[sampleIndex]) >= nonSilentAmplitudeThreshold
        ) {
            if (nonSilentSamplesInSection === 0) {
                sectionStart = sampleIndex;
            }
            nonSilentSamplesInSection++;
            silentSamplesInSequence = 0;
        } else {
            silentSamplesInSequence++;
        }

        if (silentSamplesInSequence > silentSamplesThreshold) {
            sectionStart = sampleIndex - 1;
            nonSilentSamplesInSection = 0;
            silentSamplesInSequence = 0;
        } else if (nonSilentSamplesInSection > nonSilentSamplesThreshold) {
            songEnd = sectionStart;
            break;
        }

        sampleIndex--;
    }

    return [(songStart / state.sampleRate) * 1000, (songEnd / state.sampleRate) * 1000];
}

function cropToAudio(state: SyncPointInfo): SyncPointInfo {
    const [songStart, songEnd] = findAudioStartAndEnd(state);
    const newState: SyncPointInfo = {
        ...state,
        syncPointMarkers: [...state.syncPointMarkers]
    };
    // move first marker
    newState.syncPointMarkers[0] = {
        ...newState.syncPointMarkers[0],
        syncTime: songStart
    };
    updateSyncPointsAfterModification(0, newState, false, true);

    // move last marker
    newState.syncPointMarkers[newState.syncPointMarkers.length - 1] = {
        ...newState.syncPointMarkers[newState.syncPointMarkers.length - 1],
        syncTime: songEnd
    };
    updateSyncPointsAfterModification(newState.syncPointMarkers.length - 1, newState, false, true);

    return newState;
}

function buildSyncPointMarkers(api: alphaTab.AlphaTabApi): SyncPointMarker[] {
    const markers: SyncPointMarker[] = [];

    const occurences = new Map<number, number>();
    let syncBpm = api.score!.tempo;
    let syncLastTick = 0;
    let syncLastMillisecondOffset = 0;

    let synthBpm = api.score!.tempo;
    let synthTimePosition = 0;
    let synthTickPosition = 0;

    for (const masterBar of api.tickCache!.masterBars) {
        const occurence = occurences.get(masterBar.masterBar.index) ?? 0;
        occurences.set(masterBar.masterBar.index, occurence + 1);

        const duration = masterBar.end - masterBar.start;

        if (masterBar.masterBar.syncPoints) {
            // if we have sync points we have to correctly walk through the points and tempo changes
            // and place the markers accordingly

            // TODO: create placeholder markers matching the time signature and relative offsets.

            let tempoChangeIndex = 0;
            for (const syncPoint of masterBar.masterBar.syncPoints) {
                if (syncPoint.syncPointValue!.barOccurence !== occurence) {
                    continue;
                }

                const syncPointTick = masterBar.start + syncPoint.ratioPosition * duration;

                // first process all tempo change until this sync point
                while (
                    tempoChangeIndex < masterBar.tempoChanges.length &&
                    masterBar.tempoChanges[tempoChangeIndex].tick <= syncPointTick
                ) {
                    const tempoChange = masterBar.tempoChanges[tempoChangeIndex];
                    const absoluteTick = tempoChange.tick;
                    const tickOffset = absoluteTick - synthTickPosition;
                    if (tickOffset > 0) {
                        const timeOffset = ticksToMilliseconds(tickOffset, synthBpm);
                        synthTickPosition = absoluteTick;
                        synthTimePosition += timeOffset;
                    }

                    synthBpm = tempoChange.tempo;
                    tempoChangeIndex++;
                }

                // process time until sync point
                const tickOffset = syncPointTick - synthTickPosition;
                if (tickOffset > 0) {
                    synthTickPosition = syncPointTick;
                    const timeOffset = ticksToMilliseconds(tickOffset, synthBpm);
                    synthTimePosition += timeOffset;
                }

                // create sync point marker
                const newMarker: SyncPointMarker = {
                    masterBarIndex: masterBar.masterBar.index,
                    occurence: occurence,
                    syncTime: syncPoint.syncPointValue!.millisecondOffset,
                    synthTime: synthTimePosition,
                    synthBpm: masterBar.tempoChanges[0].tempo,
                    modifiedTempo: syncPoint!.syncPointValue!.modifiedTempo,
                    markerType:
                        syncPoint.ratioPosition === 0
                            ? SyncPointMarkerType.MasterBar
                            : SyncPointMarkerType.Intermediate,
                    ratioPosition: syncPoint.ratioPosition,
                    synthTick: synthTickPosition
                };
                if (syncPointTick === 0) {
                    newMarker.markerType = SyncPointMarkerType.StartMarker;
                }
                markers.push(newMarker);

                // remember values for artificially generated markers
                syncBpm = syncPoint.syncPointValue!.modifiedTempo;
                syncLastMillisecondOffset = syncPoint.syncPointValue!.millisecondOffset;
                syncLastTick = masterBar.start;
            }

            // process remaining tempo changes after all sync points
            while (tempoChangeIndex < masterBar.tempoChanges.length) {
                const tempoChange = masterBar.tempoChanges[tempoChangeIndex];
                const absoluteTick = tempoChange.tick;
                const tickOffset = absoluteTick - synthTickPosition;
                if (tickOffset > 0) {
                    const timeOffset = ticksToMilliseconds(tickOffset, synthBpm);
                    synthTickPosition = absoluteTick;
                    synthTimePosition += timeOffset;
                }

                synthBpm = tempoChange.tempo;
                tempoChangeIndex++;
            }
        } else {
            // TODO: Create intermediate markers matching time signature

            // if there are no sync points, we create a main masterbar sync point marker at start
            let tickOffset = masterBar.start - syncLastTick;

            const newMarker: SyncPointMarker = {
                masterBarIndex: masterBar.masterBar.index,
                occurence: occurence,
                syncTime: syncLastMillisecondOffset + ticksToMilliseconds(tickOffset, syncBpm),
                synthTime: synthTimePosition,
                synthTick: synthTickPosition,
                synthBpm: masterBar.tempoChanges[0].tempo,
                modifiedTempo: undefined,
                markerType: masterBar.start === 0 ? SyncPointMarkerType.StartMarker : SyncPointMarkerType.MasterBar,
                ratioPosition: 0
            };
            markers.push(newMarker);

            // and then we walk through the tempo changes
            for (const changes of masterBar.tempoChanges) {
                const absoluteTick = changes.tick;
                const tickOffset = absoluteTick - synthTickPosition;
                if (tickOffset > 0) {
                    const timeOffset = ticksToMilliseconds(tickOffset, synthBpm);

                    synthTickPosition = absoluteTick;
                    synthTimePosition += timeOffset;
                }

                synthBpm = changes.tempo;
            }

            // don't forget the part after the last tempo change
            tickOffset = masterBar.end - synthTickPosition;
            const timeOffset = ticksToMilliseconds(tickOffset, synthBpm);
            synthTickPosition += tickOffset;
            synthTimePosition += timeOffset;
        }
    }

    // at the very end we create the end marker
    const lastMasterBar = api.tickCache!.masterBars.at(-1)!;
    const endSyncPoint = lastMasterBar.masterBar.syncPoints?.find(m => m.ratioPosition === 1);

    const tickOffset = lastMasterBar.end - syncLastTick;
    const endSyncPointTime = endSyncPoint
        ? endSyncPoint.syncPointValue!.millisecondOffset
        : syncLastMillisecondOffset + ticksToMilliseconds(tickOffset, syncBpm);

    markers.push({
        masterBarIndex: lastMasterBar.masterBar.index,
        occurence: occurences.get(lastMasterBar.masterBar.index)!,
        syncTime: endSyncPointTime,
        synthTime: synthTimePosition,
        synthBpm,
        modifiedTempo: endSyncPoint?.syncPointValue?.modifiedTempo ?? synthBpm,
        markerType: SyncPointMarkerType.EndMarker,
        ratioPosition: 1,
        synthTick: synthTickPosition
    });

    return markers;
}

const pixelPerMilliseconds = 100 / 1000 /* 100px per 1000ms */;
const leftPadding = 15;
const barNumberHeight = 20;
const arrowHeight = 20;
const timeAxisHeight = 20;
const timeAxiSubSecondTickHeight = 5;
const barWidth = 1;
const timeAxisLineColor = '#A5A5A5';
const waveFormColor = '#436d9d99';
const font = '12px "Noto Sans"';
const dragLimit = 10;
const dragThreshold = 5;
const scrollThresholdPercent = 0.2;

function timePositionToX(timePosition: number, zoom: number): number {
    const zoomedPixelPerMilliseconds = pixelPerMilliseconds * zoom;
    return timePosition * zoomedPixelPerMilliseconds + leftPadding;
}

type MarkerDragInfo = {
    startX: number;
    startY: number;
    endX: number;
};

function computeMarkerInlineStyle(
    m: SyncPointMarker,
    zoom: number,
    draggingMarker: SyncPointMarker | null,
    draggingMarkerInfo: MarkerDragInfo | null
): React.CSSProperties {
    let left = timePositionToX(m.syncTime, zoom);

    if (m === draggingMarker && draggingMarkerInfo) {
        const deltaX = draggingMarkerInfo.endX - draggingMarkerInfo.startX;
        left += deltaX;
    }

    return {
        left: `${left}px`
    };
}

function updateSyncPointsAfterModification(
    modifiedIndex: number,
    s: SyncPointInfo,
    isDelete: boolean,
    cloneMarkers: boolean
) {
    // find previous and next sync point (or start/end of the song)
    let startIndexForUpdate = Math.max(0, modifiedIndex - 1);
    while (startIndexForUpdate > 0 && !s.syncPointMarkers[startIndexForUpdate].modifiedTempo) {
        startIndexForUpdate--;
    }

    let nextIndexForUpdate = Math.min(s.syncPointMarkers.length - 1, modifiedIndex + 1);
    while (
        nextIndexForUpdate < s.syncPointMarkers.length - 1 &&
        !s.syncPointMarkers[nextIndexForUpdate].modifiedTempo
    ) {
        nextIndexForUpdate++;
    }

    const modifiedMarker = s.syncPointMarkers[modifiedIndex];

    // update from previous to current
    if (startIndexForUpdate < modifiedIndex) {
        const previousMarker = cloneMarkers
            ? { ...s.syncPointMarkers[startIndexForUpdate] }
            : s.syncPointMarkers[startIndexForUpdate];
        s.syncPointMarkers[startIndexForUpdate] = previousMarker;
        const synthDuration = modifiedMarker.synthTime - previousMarker.synthTime;
        const syncedDuration = modifiedMarker.syncTime - previousMarker.syncTime;
        const newBpmBefore = (synthDuration / syncedDuration) * previousMarker.synthBpm;
        previousMarker.modifiedTempo = newBpmBefore;

        let syncedTimePosition = previousMarker.syncTime;
        for (let i = startIndexForUpdate; i < modifiedIndex; i++) {
            const marker = cloneMarkers ? { ...s.syncPointMarkers[i] } : s.syncPointMarkers[i];
            s.syncPointMarkers[i] = marker;

            marker.syncTime = syncedTimePosition;

            if (i < modifiedIndex - 1) {
                const tickDuration = s.syncPointMarkers[i + 1].synthTick - marker.synthTick;
                syncedTimePosition += ticksToMilliseconds(tickDuration, newBpmBefore);
            }
        }
    }

    if (!isDelete) {
        const nextMarker = s.syncPointMarkers[nextIndexForUpdate];
        const synthDuration = nextMarker.synthTime - modifiedMarker.synthTime;
        const syncedDuration = nextMarker.syncTime - modifiedMarker.syncTime;
        const newBpmAfter = (synthDuration / syncedDuration) * modifiedMarker.synthBpm;
        modifiedMarker.modifiedTempo = newBpmAfter;

        const tickDuration = s.syncPointMarkers[modifiedIndex + 1].synthTick - modifiedMarker.synthTick;
        let syncedTimePosition = modifiedMarker.syncTime + ticksToMilliseconds(tickDuration, newBpmAfter);

        for (let i = modifiedIndex + 1; i < nextIndexForUpdate; i++) {
            const marker = cloneMarkers ? { ...s.syncPointMarkers[i] } : s.syncPointMarkers[i];
            s.syncPointMarkers[i] = marker;
            marker.syncTime = syncedTimePosition;

            if (i < nextIndexForUpdate - 1) {
                const tickDuration = s.syncPointMarkers[i + 1].synthTick - marker.synthTick;
                syncedTimePosition += ticksToMilliseconds(tickDuration, newBpmAfter);
            }
        }
    }
}

type UndoStack = {
    undo: SyncPointInfo[];
    redo: SyncPointInfo[];
};

export const MediaSyncEditor: React.FC<MediaSyncEditorProps> = ({ api, score }) => {
    const markerCanvas = useRef<HTMLCanvasElement | null>(null);
    const waveFormCanvas = useRef<HTMLCanvasElement | null>(null);
    const syncArea = useRef<HTMLDivElement | null>(null);

    const [canvasSize, setCanvasSize] = useState([0, 0]);
    const [virtualWidth, setVirtualWidth] = useState(0);
    const [zoom, setZoom] = useState(1);

    const [syncPointInfo, setSyncPointInfo] = useState<SyncPointInfo>({
        endTick: 0,
        endTime: 0,
        sampleRate: 44100,
        leftSamples: new Float32Array(0),
        rightSamples: new Float32Array(0),
        syncPointMarkers: []
    });

    const [draggingMarker, setDraggingMarker] = useState<SyncPointMarker | null>(null);
    const [draggingMarkerInfo, setDraggingMarkerInfo] = useState<MarkerDragInfo | null>(null);
    const [undoStack, setUndoStack] = useState<UndoStack>({ undo: [], redo: [] });
    const [shouldStoreToUndo, setStoreToUndo] = useState(false);
    const [shouldApplySyncPoints, setApplySyncPoints] = useState(false);
    const [shouldCreateInitialSyncPoints, setCreateInitialSyncPoints] = useState(false);

    const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
    const [playbackTime, setPlaybackTime] = useState<number>(0);

    useEffect(() => {
        setAudioElement(
            (api.player!.output as alphaTab.synth.IAudioElementBackingTrackSynthOutput)?.audioElement ?? null
        );
    }, [api.player!.output]);

    useAlphaTabEvent(
        api,
        'midiLoad',
        () => {
            setAudioElement(
                (api.player!.output as alphaTab.synth.IAudioElementBackingTrackSynthOutput)?.audioElement ?? null
            );
            buildSyncPointInfoFromApi(api, shouldCreateInitialSyncPoints).then(x => setSyncPointInfo(x));
            setCreateInitialSyncPoints(false);
        },
        [shouldCreateInitialSyncPoints]
    );

    useEffect(() => {
        if (syncArea.current) {
            const xPos = timePositionToX(playbackTime, zoom);
            const canvasWidth = canvasSize[0];
            const threshold = canvasWidth * scrollThresholdPercent;
            const scrollOffset = syncArea.current.scrollLeft;

            // is out of screen?
            if (xPos < scrollOffset + threshold || xPos - scrollOffset > canvasWidth - threshold) {
                syncArea.current.scrollTo({
                    left: xPos - canvasWidth / 2,
                    behavior: 'smooth'
                });
            }
        }
    }, [api, playbackTime, canvasSize, syncArea]);

    useEffect(() => {
        const updateWaveFormCursor = () => {
            setPlaybackTime(audioElement!.currentTime * 1000);
        };

        let timeUpdate: number = 0;

        if (audioElement) {
            console.log('Audio element', audioElement);
            audioElement.addEventListener('timeupdate', updateWaveFormCursor);
            audioElement.addEventListener('durationchange', updateWaveFormCursor);
            audioElement.addEventListener('seeked', updateWaveFormCursor);
            timeUpdate = window.setInterval(() => {
                if (audioElement) {
                    setPlaybackTime(audioElement.currentTime * 1000);
                }
            }, 50);
            updateWaveFormCursor();
        }

        return () => {
            if (audioElement) {
                console.log('unregister Audio element', audioElement);
                audioElement.removeEventListener('timeupdate', updateWaveFormCursor);
                audioElement.removeEventListener('durationchange', updateWaveFormCursor);
                audioElement.removeEventListener('seeked', updateWaveFormCursor);
                window.clearInterval(timeUpdate);
            }
        };
    }, [audioElement]);

    useEffect(() => {
        if (!syncPointInfo) {
            return;
        }
        if (shouldStoreToUndo) {
            setUndoStack(s => ({
                undo: [...s.undo, syncPointInfo],
                redo: []
            }));
            setStoreToUndo(false);
        }

        const syncPointLookup = new Map<number, alphaTab.model.Automation[]>();
        for (const m of syncPointInfo.syncPointMarkers) {
            if (m.modifiedTempo) {
                let syncPoints = syncPointLookup.get(m.masterBarIndex);
                if (!syncPoints) {
                    syncPoints = [];
                    syncPointLookup.set(m.masterBarIndex, syncPoints);
                }

                const automation = new alphaTab.model.Automation();
                automation.ratioPosition = m.ratioPosition;
                automation.type = alphaTab.model.AutomationType.SyncPoint;
                automation.syncPointValue = new alphaTab.model.SyncPointData();
                automation.syncPointValue.modifiedTempo = m.modifiedTempo;
                automation.syncPointValue.millisecondOffset = m.syncTime;
                automation.syncPointValue.barOccurence = m.occurence;
                syncPoints.push(automation);
            }
        }

        if (shouldApplySyncPoints) {
            console.log('Apply Sync points', syncPointLookup);

            // remember and set again the tick position after sync point update
            // this will ensure the cursor and player seek accordingly with keeping the cursor
            // where it is currently shown on the notation.
            const tickPosition = api.tickPosition;
            for (const masterBar of score.masterBars) {
                masterBar.syncPoints = syncPointLookup.get(masterBar.index);
            }
            api.updateSyncPoints();
            api.tickPosition = tickPosition;
            setApplySyncPoints(false);
        }
    }, [syncPointInfo]);

    const undo = () => {
        setUndoStack(s => {
            const newStack = { ...s };
            if (newStack.undo.length > 0) {
                const undoState = newStack.undo.pop()!;
                newStack.redo.push(undoState);
                setApplySyncPoints(true);
                setSyncPointInfo(newStack.undo.at(-1)!);
            }
            return newStack;
        });
    };

    const redo = () => {
        setUndoStack(s => {
            const newStack = { ...s };
            if (newStack.redo.length > 0) {
                const redoState = newStack.redo.pop()!;
                newStack.undo.push(redoState);
                setApplySyncPoints(true);
                setSyncPointInfo(redoState);
            }
            return newStack;
        });
    };

    const toggleMarker = (marker: SyncPointMarker, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setStoreToUndo(true);
        setApplySyncPoints(true);
        setSyncPointInfo(s => {
            if (!s) {
                return s;
            }

            // no removal of start and end marker
            if (
                marker.markerType === SyncPointMarkerType.StartMarker ||
                marker.markerType === SyncPointMarkerType.EndMarker
            ) {
                return s;
            }

            const markerIndex = s!.syncPointMarkers.indexOf(marker);
            if (markerIndex === -1) {
                return s;
            }

            const newS: SyncPointInfo = { ...s, syncPointMarkers: [...s.syncPointMarkers] };
            if (marker.modifiedTempo) {
                switch (marker.markerType) {
                    case SyncPointMarkerType.MasterBar:
                        newS.syncPointMarkers[markerIndex] = { ...marker, modifiedTempo: undefined };
                        break;
                    case SyncPointMarkerType.Intermediate:
                        newS.syncPointMarkers.splice(markerIndex, 1);
                        break;
                }
                updateSyncPointsAfterModification(markerIndex, newS, true, true);
            } else {
                updateSyncPointsAfterModification(markerIndex, newS, false, true);
            }

            return newS;
        });
    };

    const mouseUpListener = useCallback(
        (e: MouseEvent) => {
            if (draggingMarker) {
                e.preventDefault();
                e.stopPropagation();

                const deltaX = draggingMarkerInfo!.endX - draggingMarkerInfo!.startX;
                if (deltaX > dragThreshold || (draggingMarker.modifiedTempo !== undefined && Math.abs(deltaX) > 0)) {
                    setStoreToUndo(true);
                    setApplySyncPoints(true);
                    setSyncPointInfo(s => {
                        if (!s) {
                            return s;
                        }

                        const markerIndex = s.syncPointMarkers.findIndex(m => m === draggingMarker);

                        const zoomedPixelPerMillisecond = pixelPerMilliseconds * zoom;
                        const deltaTime = deltaX / zoomedPixelPerMillisecond;

                        const newTimePosition = draggingMarker.syncTime + deltaTime;

                        const newS: SyncPointInfo = { ...s, syncPointMarkers: [...s.syncPointMarkers] };

                        // move the marker to the new position
                        newS.syncPointMarkers[markerIndex] = {
                            ...newS.syncPointMarkers[markerIndex],
                            syncTime: Math.max(0, newTimePosition)
                        };

                        updateSyncPointsAfterModification(markerIndex, newS, false, true);
                        return newS;
                    });
                }

                setDraggingMarker(null);
                setDraggingMarkerInfo(null);
            }
        },
        [draggingMarker, draggingMarkerInfo]
    );

    const mouseMoveListener = useCallback(
        (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            setDraggingMarkerInfo(s => {
                if (!s || !syncPointInfo) {
                    return s;
                }

                const index = syncPointInfo.syncPointMarkers.indexOf(draggingMarker!);
                if (index === -1) {
                    return s;
                }

                let pageX = e.pageX;
                const deltaX = pageX - s.startX;

                if (deltaX < 0) {
                    if (index > 0) {
                        const thisX = timePositionToX(draggingMarker!.syncTime, zoom);
                        const newX = thisX + deltaX;

                        let previousMarkerIndex = index - 1;
                        if (draggingMarker!.markerType !== SyncPointMarkerType.Intermediate) {
                            while (
                                previousMarkerIndex > 0 &&
                                !syncPointInfo.syncPointMarkers[previousMarkerIndex].modifiedTempo
                            ) {
                                previousMarkerIndex--;
                            }
                        }

                        const previousMarker = syncPointInfo.syncPointMarkers[previousMarkerIndex];
                        const previousX = timePositionToX(previousMarker.syncTime, zoom);
                        const minX = previousX + dragLimit;

                        if (newX < minX) {
                            pageX = s.startX - (thisX - minX);
                        }
                    }

                } else {
                    if (index < syncPointInfo.syncPointMarkers.length - 1) {
                        const thisX = timePositionToX(draggingMarker!.syncTime, zoom);
                        const newX = thisX + deltaX;

                        let nextMarkerIndex = index + 1;
                        if (draggingMarker!.markerType !== SyncPointMarkerType.Intermediate) {
                            while (
                                nextMarkerIndex < syncPointInfo.syncPointMarkers.length - 1 &&
                                !syncPointInfo.syncPointMarkers[nextMarkerIndex].modifiedTempo
                            ) {
                                nextMarkerIndex++;
                            }
                        }

                        const nextMarker = syncPointInfo.syncPointMarkers[nextMarkerIndex];
                        const nextX = timePositionToX(nextMarker.syncTime, zoom);
                        const maxX = nextX - dragLimit;

                        if (newX > maxX) {
                            pageX = s.startX + (maxX - thisX);
                        }
                    }
                }

                return { ...s, endX: pageX };
            });
        },
        [draggingMarker, syncPointInfo]
    );

    useEffect(() => {
        if (draggingMarker) {
            document.addEventListener('mouseup', mouseUpListener);
            document.addEventListener('mousemove', mouseMoveListener);
        }

        return () => {
            document.removeEventListener('mouseup', mouseUpListener);
            document.removeEventListener('mousemove', mouseMoveListener);
        };
    }, [draggingMarker, mouseUpListener, mouseMoveListener]);

    const startMarkerDrag = (marker: SyncPointMarker, e: React.MouseEvent) => {
        if (e.button !== 0 || marker.modifiedTempo === undefined) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setDraggingMarkerInfo(() => ({ startX: e.pageX, startY: e.pageY, endX: e.pageX }));
        setDraggingMarker(() => marker);
    };

    useEffect(() => {
        setUndoStack({
            undo: [],
            redo: []
        });
        setStoreToUndo(true);
        buildSyncPointInfoFromApi(api, shouldCreateInitialSyncPoints).then(x => setSyncPointInfo(x));
        setCreateInitialSyncPoints(false);
    }, [api]);

    const drawWaveform = () => {
        const can = waveFormCanvas.current;
        if (!syncPointInfo || !can) {
            return;
        }

        const ctx = can.getContext('2d')!;
        ctx.clearRect(0, 0, can.width, can.height);
        ctx.save();

        const waveFormY = barNumberHeight + arrowHeight;
        const halfHeight = ((can.height - waveFormY - timeAxisHeight) / 2) | 0;

        // frame
        ctx.fillStyle = timeAxisLineColor;
        ctx.fillRect(0, waveFormY + 2 * halfHeight, can.width, 1);
        ctx.fillRect(0, barNumberHeight, can.width, 1);
        ctx.fillRect(0, waveFormY, can.width, 1);
        ctx.fillRect(0, waveFormY + halfHeight, can.width, 1);

        // waveform
        ctx.translate(-syncArea.current!.scrollLeft, 0);

        ctx.beginPath();

        const startX = Math.max(syncArea.current!.scrollLeft - leftPadding, 0);
        const endX = startX + can.width + leftPadding;

        const zoomedPixelPerMillisecond = pixelPerMilliseconds * zoom;
        const samplesPerPixel = syncPointInfo.sampleRate / (zoomedPixelPerMillisecond * 1000);

        for (let x = startX; x < endX; x += barWidth) {
            const startSample = (x * samplesPerPixel) | 0;
            const endSample = ((x + barWidth) * samplesPerPixel) | 0;

            let maxTop = 0;
            let maxBottom = 0;
            for (let sample = startSample; sample <= endSample; sample++) {
                const magnitudeTop = Math.abs(syncPointInfo.leftSamples[sample] || 0);
                const magnitudeBottom = Math.abs(syncPointInfo.rightSamples[sample] || 0);
                if (magnitudeTop > maxTop) {
                    maxTop = magnitudeTop;
                }
                if (magnitudeBottom > maxBottom) {
                    maxBottom = magnitudeBottom;
                }
            }

            const topBarHeight = Math.min(halfHeight, Math.round(maxTop * halfHeight));
            const bottomBarHeight = Math.min(halfHeight, Math.round(maxBottom * halfHeight));
            const barHeight = topBarHeight + bottomBarHeight || 1;
            ctx.rect(x + leftPadding, waveFormY + (halfHeight - topBarHeight), barWidth, barHeight);
        }

        ctx.fillStyle = waveFormColor;
        ctx.fill();

        // time axis
        ctx.save();

        ctx.fillStyle = timeAxisLineColor;
        ctx.font = font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';

        const timeAxisY = waveFormY + 2 * halfHeight;
        const leftTimeSecond = Math.floor((startX - leftPadding) / zoomedPixelPerMillisecond / 1000);
        const rightTimeSecond = Math.ceil(endX / zoomedPixelPerMillisecond / 1000);

        const leftTime = leftTimeSecond * 1000;
        const rightTime = rightTimeSecond * 1000;

        let time = leftTime;
        while (time <= rightTime) {
            const timeX = timePositionToX(time, zoom);
            ctx.fillRect(timeX, timeAxisY, 1, timeAxisHeight);

            const totalSeconds = Math.abs(time / 1000);

            const minutes = Math.floor(totalSeconds / 60);
            const seconds = Math.floor(totalSeconds - minutes * 60);

            const sign = time < 0 ? '-' : '';
            const minutesText = minutes.toString().padStart(2, '0');
            const secondsText = seconds.toString().padStart(2, '0');

            ctx.fillText(`${sign}${minutesText}:${secondsText}`, timeX + 3, timeAxisY + timeAxisHeight);

            const nextSecond = time + 1000;
            while (time < nextSecond) {
                const subSecondX = timePositionToX(time, zoom);
                ctx.fillRect(subSecondX, timeAxisY, 1, timeAxiSubSecondTickHeight);

                time += 100;
            }
        }

        ctx.restore();
        ctx.restore();
    };

    useEffect(() => {
        if (waveFormCanvas.current) {
            waveFormCanvas.current.width = canvasSize[0];
            waveFormCanvas.current.height = canvasSize[1];
        }
        drawWaveform();
    }, [waveFormCanvas, canvasSize]);

    useResizeObserver(syncArea, entry => {
        setCanvasSize(s => [entry.contentRect.width, entry.contentRect.height]);
    });

    useEffect(() => {
        if (syncPointInfo) {
            setVirtualWidth(s => pixelPerMilliseconds * syncPointInfo.endTime * zoom);
        }
        drawWaveform();
    }, [markerCanvas, syncPointInfo, zoom]);

    useEffect(() => {
        if (shouldCreateInitialSyncPoints) {
            // clear any potential sync points
            for (const m of score.masterBars) {
                m.syncPoints = undefined;
            }
            api.updateSettings();
            api.loadMidiForScore();
        }
    }, [shouldCreateInitialSyncPoints]);

    const onLoadAudioFile = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.mp3,.ogg,*.wav,*.flac,*.aac';
        input.onchange = () => {
            if (input.files?.length === 1) {
                const reader = new FileReader();
                reader.onload = e => {
                    // setup backing track
                    score.backingTrack = new alphaTab.model.BackingTrack();
                    score.backingTrack.rawAudioFile = new Uint8Array(e.target!.result as ArrayBuffer);

                    // create a fresh set of sync points upon load (start->end)
                    setApplySyncPoints(true);
                    setCreateInitialSyncPoints(true);
                };
                reader.readAsArrayBuffer(input.files[0]);
            }
        };
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    };

    const onResetSyncPoints = () => {
        setApplySyncPoints(true);
        setStoreToUndo(true);
        setSyncPointInfo(s => {
            return s ? resetSyncPoints(api, s) : s;
        });
    };

    const onCropToAudio = () => {
        setApplySyncPoints(true);
        setStoreToUndo(true);
        setSyncPointInfo(s => {
            return s ? cropToAudio(s) : s;
        });
    };

    function buildMarkerLabel(m: SyncPointMarker): React.ReactNode {
        switch (m.markerType) {
            case SyncPointMarkerType.StartMarker:
                return 'Start';
            case SyncPointMarkerType.EndMarker:
                return 'End';
            case SyncPointMarkerType.MasterBar:
                if (m.occurence > 0) {
                    return `${m.masterBarIndex + 1} (${m.occurence + 1})`;
                }
                return `${m.masterBarIndex + 1}`;
            case SyncPointMarkerType.Intermediate:
                return '';
        }
    }

    return (
        <div className={styles['media-sync-editor']}>
            <div className={styles.toolbar}>
                <button
                    className="button button--secondary"
                    type="button"
                    data-tooltip-id="tooltip-playground"
                    onClick={() => {
                        onLoadAudioFile();
                    }}
                    data-tooltip-content="Load Audio File">
                    <FontAwesomeIcon icon={solid.faFileAudio} />
                </button>
                <button
                    className="button button--secondary"
                    type="button"
                    data-tooltip-id="tooltip-playground"
                    data-tooltip-content="Load Youtube Video">
                    <FontAwesomeIcon icon={brands.faYoutube} />
                </button>
                <div className={'dropdown dropdown--hoverable'}>
                    <button type="button" className={'button button--secondary'} data-toggle="dropdown">
                        <FontAwesomeIcon icon={solid.faMapPin} />
                    </button>
                    <ul className={'dropdown__menu'}>
                        <li>
                            <a
                                className="dropdown__link"
                                href="#reset-sync-points"
                                onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onResetSyncPoints();
                                }}>
                                Reset Sync Points
                            </a>
                        </li>
                        <li>
                            <a
                                className="dropdown__link"
                                href="#crop-to-audio"
                                onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onCropToAudio();
                                }}>
                                Crop to Headable Audio
                            </a>
                        </li>
                    </ul>
                </div>

                <button
                    className="button button--secondary"
                    type="button"
                    data-tooltip-id="tooltip-playground"
                    data-tooltip-content="Zoom Out"
                    onClick={() => {
                        setZoom(v => v / 1.2);
                    }}>
                    <FontAwesomeIcon icon={solid.faMagnifyingGlassMinus} />
                </button>

                <button
                    className="button button--secondary button--outline"
                    type="button"
                    onClick={() => {
                        setZoom(1);
                    }}>{`${(zoom * 100).toFixed(1)}%`}</button>

                <button
                    className="button button--secondary"
                    type="button"
                    data-tooltip-id="tooltip-playground"
                    data-tooltip-content="Zoom In"
                    onClick={() => {
                        setZoom(v => v * 1.2);
                    }}>
                    <FontAwesomeIcon icon={solid.faMagnifyingGlassPlus} />
                </button>

                <button
                    className="button button--secondary"
                    type="button"
                    data-tooltip-id="tooltip-playground"
                    data-tooltip-content="Undo"
                    disabled={undoStack.undo.length <= 1}
                    onClick={() => {
                        undo();
                    }}>
                    <FontAwesomeIcon icon={solid.faUndo} />
                </button>

                <button
                    className="button button--secondary"
                    type="button"
                    data-tooltip-id="tooltip-playground"
                    data-tooltip-content="Redo"
                    disabled={undoStack.redo.length === 0}
                    onClick={() => {
                        redo();
                    }}>
                    <FontAwesomeIcon icon={solid.faRedo} />
                </button>
            </div>
            <div className={styles['sync-area']} ref={syncArea} onScroll={() => drawWaveform()}>
                <div className={styles['sync-area-canvas-wrap']}>
                    <canvas ref={waveFormCanvas} />
                </div>
                <div
                    className={styles['sync-area-marker-wrap']}
                    style={{ width: `${virtualWidth}px`, height: `${canvasSize[1]}px` }}>
                    {syncPointInfo.syncPointMarkers.map(m => (
                        <div
                            key={`${m.masterBarIndex}-${m.occurence}-${m.ratioPosition.toFixed(1)}`}
                            className={`${styles['masterbar-marker']} ${styles[`masterbar-marker-${SyncPointMarkerType[m.markerType].toLowerCase()}`]}  ${m.modifiedTempo !== undefined ? styles['has-sync-point'] : ''}`}
                            style={computeMarkerInlineStyle(m, zoom, draggingMarker, draggingMarkerInfo)}
                            onDoubleClick={e => toggleMarker(m, e)}
                            onMouseDown={e => {
                                startMarkerDrag(m, e);
                            }}>
                            <div className={styles['marker-label']}>{buildMarkerLabel(m)}</div>
                            <div className={styles['marker-head']}>
                                <div className={`${styles['marker-arrow']}`} />
                                {m.markerType !== SyncPointMarkerType.EndMarker && m.modifiedTempo && (
                                    <div className={styles['marker-tempo']}>{m.modifiedTempo.toFixed(1)} bpm</div>
                                )}
                            </div>
                            <div className={styles['marker-line']} />
                        </div>
                    ))}
                </div>
                <div
                    className={styles['sync-area-playback-cursor']}
                    style={{ transform: `translateX(${timePositionToX(playbackTime, zoom)}px)` }}
                />
            </div>
        </div>
    );
};
