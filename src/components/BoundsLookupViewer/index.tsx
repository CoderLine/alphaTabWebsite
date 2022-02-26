import React from "react";
import * as alphaTab from '@coderline/alphatab';

enum GuideType {
    VisualBounds = 0,
    RealBounds = 1
}

enum GuideElements {
    StaveGroups = 0,
    MasterBars = 1,
    Bars = 2,
    Beats = 3,
    Notes = 4,
};

export interface BoundsLookupViewerState {
    type: GuideType;
    elements: GuideElements;
}

export interface BoundsLookupViewerProps {
    children: string | React.ReactElement
}

export class BoundsLookupViewer extends React.Component<BoundsLookupViewerProps, BoundsLookupViewerState> {
    private _api: alphaTab.AlphaTabApi;
    private _element: React.RefObject<HTMLDivElement> = React.createRef();

    constructor(props) {
        super(props);
        this.state = {
            type: GuideType.VisualBounds,
            elements: GuideElements.StaveGroups,
        };
    }

    componentDidMount() {
        const container = this._element.current;
        const settings = new alphaTab.Settings();
        settings.core.tex = true;
        settings.core.tracks = 'all';
        settings.core.includeNoteBounds = true;

        this._api = new alphaTab.AlphaTabApi(container, settings);
        this._api.postRenderFinished.on(this.updateVisualGuides.bind(this));
    }

    updateVisualGuides() {
        const container = this._element.current;
        let guidesWrapper = container.querySelector<HTMLDivElement>(".at-guides");
        if (!guidesWrapper) {
            container.style.position = "relative";
            guidesWrapper = document.createElement("div");
            guidesWrapper.classList.add("at-guides");
            guidesWrapper.style.position = "absolute";
            guidesWrapper.style.zIndex = "1000";
            guidesWrapper.style.display = "inline";
            guidesWrapper.style.pointerEvents = "none";
            guidesWrapper.style.top = "0";
            guidesWrapper.style.left = "0";
            guidesWrapper.style.right = "0";
            guidesWrapper.style.bottom = "0";
            container.insertBefore(guidesWrapper, container.firstChild);
        } else {
            guidesWrapper.innerHTML = "";
        }

        if (this._api.renderer.boundsLookup) {
            this.createStaveGroupGuides(
                guidesWrapper,
                this._api.renderer.boundsLookup
            );
        }
    }

    createStaveGroupGuides(wrapper: HTMLDivElement, lookup: alphaTab.rendering.BoundsLookup) {
        for (const staveGroup of lookup.staveGroups) {
            if (this.state.elements === GuideElements.StaveGroups) {
                this.createGuide(wrapper, staveGroup, "#1976d2");
            } else {
                this.createMasterBarGuides(wrapper, staveGroup);
            }
        }
    }

    createMasterBarGuides(wrapper: HTMLDivElement, staveGroup: alphaTab.rendering.StaveGroupBounds) {
        for (const masterBar of staveGroup.bars) {
            if (this.state.elements === GuideElements.MasterBars) {
                this.createGuide(wrapper, masterBar, "#388e3c");
            } else {
                this.createBarGuides(wrapper, masterBar);
            }
        }
    }

    createBarGuides(wrapper: HTMLDivElement, masterBar: alphaTab.rendering.MasterBarBounds) {
        for (const bar of masterBar.bars) {
            if (this.state.elements === GuideElements.Bars) {
                this.createGuide(wrapper, bar, "#fdd835");
            } else {
                this.createBeatGuides(wrapper, bar);
            }
        }
    }

    createBeatGuides(wrapper: HTMLDivElement, bar: alphaTab.rendering.BarBounds) {
        for (const beat of bar.beats) {
            if (this.state.elements === GuideElements.Beats) {
                this.createGuide(wrapper, beat, "#e64a19");
            } else {
                this.createNoteGuides(wrapper, beat);
            }
        }
    }

    createNoteGuides(wrapper: HTMLDivElement, beat: alphaTab.rendering.BeatBounds) {
        if (beat.notes) {
            for (const note of beat.notes) {
                this.createGuide(wrapper, note.noteHeadBounds, "#512da8");
            }
        }
    }

    createGuide(wrapper: HTMLDivElement, bounds: alphaTab.rendering.Bounds | {
        visualBounds: alphaTab.rendering.Bounds,
        realBounds: alphaTab.rendering.Bounds
    }, color: string) {
        const guide = document.createElement("div");
        guide.style.position = "absolute";
        const rect =
            "x" in bounds
                ? bounds
                : this.state.type === GuideType.VisualBounds
                    ? bounds.visualBounds
                    : bounds.realBounds;
        guide.style.left = rect.x + "px";
        guide.style.top = rect.y + "px";
        guide.style.width = rect.w + "px";
        guide.style.height = rect.h + "px";
        guide.style.border = `1px solid ${color}`;
        guide.style.background = BoundsLookupViewer.hexToRgba(color, 0.5);
        wrapper.appendChild(guide);
    }

    static hexToRgba(hex: string, alpha: number) {
        let c = hex.substring(1).split("");
        if (c.length == 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        const n = parseInt(c.join(""), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255},${alpha})`;
    }

    componentWillUnmount() {
        this._api.destroy();
    }

    setType(type: GuideType) {
        this.setState({
            type
        });
        this.updateVisualGuides();
    }

    setElements(elements: GuideElements) {
        this.setState({
            elements
        });
        this.updateVisualGuides();
    }

    typeClass(ownType) {
        return ownType === this.state.type ? " active" : "";
    }

    elementClass(ownElements) {
        return ownElements === this.state.elements ? " active" : "";
    }

    render() {
        return (
            <>
                <div className="btn-toolbar" role="toolbar">
                    <div className="btn-group mr-2" role="group">
                        <button
                            type="button"
                            className={
                                "btn btn-secondary" + this.typeClass(GuideType.VisualBounds)
                            }
                            onClick={this.setType.bind(this, GuideType.VisualBounds)}
                        >
                            Visual Bounds
                        </button>
                        <button
                            type="button"
                            className={
                                "btn btn-secondary" + this.typeClass(GuideType.RealBounds)
                            }
                            onClick={this.setType.bind(this, GuideType.RealBounds)}
                        >
                            Real Bounds
                        </button>
                    </div>
                    <div className="btn-group mr-2" role="group">
                        <button
                            type="button"
                            className={
                                "btn btn-secondary" +
                                this.elementClass(GuideElements.StaveGroups)
                            }
                            onClick={this.setElements.bind(this, GuideElements.StaveGroups)}
                        >
                            Stave Groups
                        </button>
                        <button
                            type="button"
                            className={
                                "btn btn-secondary" +
                                this.elementClass(GuideElements.MasterBars)
                            }
                            onClick={this.setElements.bind(this, GuideElements.MasterBars)}
                        >
                            Master Bars
                        </button>
                        <button
                            type="button"
                            className={
                                "btn btn-secondary" + this.elementClass(GuideElements.Bars)
                            }
                            onClick={this.setElements.bind(this, GuideElements.Bars)}
                        >
                            Bars
                        </button>
                        <button
                            type="button"
                            className={
                                "btn btn-secondary" + this.elementClass(GuideElements.Beats)
                            }
                            onClick={this.setElements.bind(this, GuideElements.Beats)}
                        >
                            Beats
                        </button>
                        <button
                            type="button"
                            className={
                                "btn btn-secondary" + this.elementClass(GuideElements.Notes)
                            }
                            onClick={this.setElements.bind(this, GuideElements.Notes)}
                        >
                            Notes
                        </button>
                    </div>
                </div>
                <div ref={this._element}>
                    {this.props.children}
                </div>
            </>
        );
    }
}
