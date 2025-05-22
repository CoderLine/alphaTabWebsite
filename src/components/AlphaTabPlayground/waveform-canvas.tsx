import type React from 'react';
import { useEffect, useRef } from 'react';
import { timePositionToX } from './helpers';

export type WaveformCanvasProps = {
    barNumberHeight?: number;
    arrowHeight?: number;

    timeAxisHeight?: number;
    timeAxisSubSecondTickHeight?: number;
    timeAxisLineColor?: string;

    waveFormColor?: string;
    pixelPerMilliseconds: number;

    leftPadding?: number;
    zoom?: number;

    scrollOffset?: number;

    sampleRate: number;
    leftSamples: Float32Array;
    rightSamples: Float32Array;

    width: number;
    height: number;
};

const defaultProps = {
    barNumberHeight: 20,
    arrowHeight: 20,

    timeAxisHeight: 20,
    timeAxisSubSecondTickHeight: 5,
    timeAxisLineColor: '#A5A5A5',

    waveFormColor: '#436d9d99',

    leftPadding: 0,
    zoom: 1,

    scrollOffset: 0
} satisfies Partial<WaveformCanvasProps>;

type DrawWaveFormOptions = typeof defaultProps & WaveformCanvasProps;

type CommonDrawInfo = {
    waveFormY: number;
    halfHeight: number;
    startX: number;
    endX: number;
    zoomedPixelPerMillisecond: number;
    samplesPerPixel: number;
};

const drawFrame = (ctx: CanvasRenderingContext2D, options: DrawWaveFormOptions, drawInfo: CommonDrawInfo) => {
    ctx.fillStyle = options.timeAxisLineColor;
    ctx.fillRect(0, drawInfo.waveFormY + 2 * drawInfo.halfHeight, ctx.canvas.width, 1);
    ctx.fillRect(0, options.barNumberHeight, ctx.canvas.width, 1);
    ctx.fillRect(0, drawInfo.waveFormY, ctx.canvas.width, 1);
    ctx.fillRect(0, drawInfo.waveFormY + drawInfo.halfHeight, ctx.canvas.width, 1);
};

const drawSamples = (ctx: CanvasRenderingContext2D, options: DrawWaveFormOptions, drawInfo: CommonDrawInfo) => {
    ctx.save();

    ctx.translate(-options.scrollOffset, 0);

    ctx.beginPath();

    const startX = Math.max(options.scrollOffset - options.leftPadding, 0);
    const endX = startX + ctx.canvas.width + options.leftPadding;

    const zoomedPixelPerMillisecond = options.pixelPerMilliseconds * options.zoom;
    const samplesPerPixel = options.sampleRate / (zoomedPixelPerMillisecond * 1000);

    for (let x = startX; x < endX; x++) {
        const startSample = (x * samplesPerPixel) | 0;
        const endSample = ((x + 1) * samplesPerPixel) | 0;

        let maxTop = 0;
        let maxBottom = 0;
        for (let sample = startSample; sample <= endSample; sample++) {
            const magnitudeTop = Math.abs(options.leftSamples[sample] || 0);
            const magnitudeBottom = Math.abs(options.rightSamples[sample] || 0);
            if (magnitudeTop > maxTop) {
                maxTop = magnitudeTop;
            }
            if (magnitudeBottom > maxBottom) {
                maxBottom = magnitudeBottom;
            }
        }

        const topBarHeight = Math.min(drawInfo.halfHeight, Math.round(maxTop * drawInfo.halfHeight));
        const bottomBarHeight = Math.min(drawInfo.halfHeight, Math.round(maxBottom * drawInfo.halfHeight));
        const barHeight = topBarHeight + bottomBarHeight || 1;
        ctx.rect(x + options.leftPadding, drawInfo.waveFormY + (drawInfo.halfHeight - topBarHeight), 1, barHeight);
    }

    ctx.fillStyle = options.waveFormColor;
    ctx.fill();

    ctx.restore();
};

const drawTimeAxis = (ctx: CanvasRenderingContext2D, options: DrawWaveFormOptions, drawInfo: CommonDrawInfo) => {
    ctx.save();
    ctx.translate(-options.scrollOffset, 0);

    ctx.fillStyle = options.timeAxisLineColor;
    const style = window.getComputedStyle(ctx.canvas);
    ctx.font = style.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    const timeAxisY = drawInfo.waveFormY + 2 * drawInfo.halfHeight;
    const leftTimeSecond = Math.floor(
        (drawInfo.startX - options.leftPadding) / drawInfo.zoomedPixelPerMillisecond / 1000
    );
    const rightTimeSecond = Math.ceil(drawInfo.endX / drawInfo.zoomedPixelPerMillisecond / 1000);

    const leftTime = leftTimeSecond * 1000;
    const rightTime = rightTimeSecond * 1000;

    let time = leftTime;
    while (time <= rightTime) {
        const timeX = timePositionToX(options.pixelPerMilliseconds, time, options.zoom, options.leftPadding);
        ctx.fillRect(timeX, timeAxisY, 1, options.timeAxisHeight);

        const totalSeconds = Math.abs(time / 1000);

        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds - minutes * 60);

        const sign = time < 0 ? '-' : '';
        const minutesText = minutes.toString().padStart(2, '0');
        const secondsText = seconds.toString().padStart(2, '0');

        ctx.fillText(`${sign}${minutesText}:${secondsText}`, timeX + 3, timeAxisY + options.timeAxisHeight);

        const nextSecond = time + 1000;
        while (time < nextSecond) {
            const subSecondX = timePositionToX(options.pixelPerMilliseconds, time, options.zoom, options.leftPadding);

            ctx.fillRect(subSecondX, timeAxisY, 1, options.timeAxisSubSecondTickHeight);

            time += 100;
        }
    }

    ctx.restore();
};
const drawWaveform = (can: HTMLCanvasElement, options: DrawWaveFormOptions) => {
    const ctx = can.getContext('2d')!;
    ctx.clearRect(0, 0, can.width, can.height);
    ctx.save();

    const waveFormY = options.barNumberHeight + options.arrowHeight;
    const halfHeight = ((ctx.canvas.height - waveFormY - options.timeAxisHeight) / 2) | 0;
    const startX = Math.max(options.scrollOffset - options.leftPadding, 0);
    const endX = startX + ctx.canvas.width + options.leftPadding;
    const zoomedPixelPerMillisecond = options.pixelPerMilliseconds * options.zoom;
    const samplesPerPixel = options.sampleRate / (zoomedPixelPerMillisecond * 1000);

    const drawInfo: CommonDrawInfo = {
        waveFormY,
        halfHeight,
        startX,
        endX,
        zoomedPixelPerMillisecond,
        samplesPerPixel
    };

    drawFrame(ctx, options, drawInfo);
    drawSamples(ctx, options, drawInfo);
    drawTimeAxis(ctx, options, drawInfo);
};

export const WaveformCanvas: React.FC<WaveformCanvasProps> = props => {
    const waveFormCanvas = useRef<HTMLCanvasElement | null>(null);

    const realProps = {
        ...defaultProps,
        ...props
    };

    useEffect(() => {
        if (waveFormCanvas.current) {
            waveFormCanvas.current.width = props.width;
            waveFormCanvas.current.height = props.height;
            drawWaveform(waveFormCanvas.current, realProps);
        }
    }, [props, waveFormCanvas]);

    return <canvas ref={waveFormCanvas} />;
};
