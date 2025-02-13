import React from "react";
import { SinceBadge } from "../SinceBadge";
import Details from "@theme/Details";
import { Tooltip } from "react-tooltip";
import ReactDOMServer from "react-dom/server";
import styles from "./styles.module.scss";

export enum FeatureStatus {
  Supported,
  Partial,
  NotSupported,
  Ignored,
  Unspecified,
}

class FeatureStatusDisplay extends React.Component<{ status: FeatureStatus }> {
  public render() {
    switch (this.props.status) {
      case FeatureStatus.Supported:
        return <>✅ Supported</>;
      case FeatureStatus.Partial:
        return <>⚠️ Partial</>;
      case FeatureStatus.NotSupported:
        return <>❌ Not Supported</>;
      case FeatureStatus.Ignored:
        return <span className={styles.ignored}>✅ Ignored</span>;
      case FeatureStatus.Unspecified:
        return <></>;
    }
    return <></>;
  }
}

type FeatureStatusDefinitionFull = {
  status: FeatureStatus;
  tooltip?: string;
  since?: string;
};

export class FileFormatFeatureCell extends React.Component<{
  status?: FeatureStatusDefinitionFull;
}> {
  public render() {
    if (!this.props.status) {
      return <></>;
    }

    const tooltip =
      this.props.status.since || this.props.status.tooltip
        ? ReactDOMServer.renderToStaticMarkup(
            <>
              <SinceBadge since={this.props.status.since} inline={true} />{" "}
              {this.props.status.tooltip}
            </>
          )
        : "";

    const classNames = ["feature-status-cell", styles.noWrap];
    if (tooltip) {
      classNames.push(styles.hasTooltip);
    }

    return (
      <>
        <span
          className={classNames.join(' ')}
          data-tooltip-html={tooltip}
        >
          <FeatureStatusDisplay status={this.props.status.status} />
        </span>
      </>
    );
  }
}

export class FileFormatFeatureGroup extends React.Component<{
  title: string;
  children: React.ReactNode;
}> {
  public render() {
    return (
      <>
        <tr>
          <td>
            <strong>{this.props.title}</strong>
          </td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
        {this.props.children}
      </>
    );
  }
}

type FeatureStatusDefinition =
  | FeatureStatus
  | [FeatureStatus]
  | [FeatureStatus, string]
  | [FeatureStatus, string, string]
  | FeatureStatusDefinitionFull;

function toFeatureStatusDefinitionFull(
  definition?: FeatureStatusDefinition
): FeatureStatusDefinitionFull | undefined {
  if (typeof definition === "undefined") {
    return undefined;
  }

  if (typeof definition === "number") {
    return {
      status: definition,
    };
  }

  if (Array.isArray(definition)) {
    if (definition.length === 1) {
      return {
        status: definition[0] as number,
      };
    } else if (definition.length === 2) {
      return {
        status: definition[0] as number,
        since: definition[1] as string,
      };
    } else if (definition.length === 3) {
      return {
        status: definition[0] as number,
        since: definition[1] as string,
        tooltip: definition[2] as string,
      };
    }
  }

  if ("status" in definition) {
    return definition;
  }

  throw new Error("Invalid status definition");
}

export class FileFormatFeatureRow extends React.Component<{
  feature: string;
  isNewFeature:boolean;

  model?: FeatureStatusDefinition;
  reading?: FeatureStatusDefinition;
  render?: FeatureStatusDefinition;
  audio?: FeatureStatusDefinition;
  tex?: FeatureStatusDefinition;
}> {
  public render() {
    return (
      <tr>
        <td>{(this.props.isNewFeature ? "⭐ " : "") + this.props.feature}</td>
        <td>
          <FileFormatFeatureCell
            status={toFeatureStatusDefinitionFull(this.props.model)}
          />
        </td>
        <td>
          <FileFormatFeatureCell
            status={toFeatureStatusDefinitionFull(this.props.reading)}
          />
        </td>
        <td>
          <FileFormatFeatureCell
            status={toFeatureStatusDefinitionFull(this.props.render)}
          />
        </td>
        <td>
          <FileFormatFeatureCell
            status={toFeatureStatusDefinitionFull(this.props.audio)}
          />
        </td>
        <td>
          <FileFormatFeatureCell
            status={toFeatureStatusDefinitionFull(this.props.tex)}
          />
        </td>
      </tr>
    );
  }
}

export class FileFormatFeatureTable extends React.Component<{
  children: React.ReactNode;
}> {
  public render() {
    return (
      <>
        <Details summary="Table Legend">
          <p>
            The following table describes the support of the different features
            of the input format.
          </p>
          <p>
            <strong>Columns</strong>
          </p>
          <ul>
            <li>Feature: The related feature. If marked with ⭐ its a new or changed feature compared to the previous version of this format (e.g. a feature added in Guitar Pro 6)</li>
            <li>
              Data Model: Whether alphaTab supports storing this information in
              its own data model (e.g. from other formats).
            </li>
            <li>
              Reading: Whether alphaTab can read this information from the file
              format.
            </li>
            <li>
              Rendering: Whether alphaTab can display the information in the
              music sheet when rendered (display might differ from reference
              software).
            </li>
            <li>
              Audio: Whether alphaTab can generate audio information for this
              feature.
            </li>
            <li>
              alphaTex: Whether this feature is supported when describing music
              notation with alphaTex.
            </li>
          </ul>
          <p>
            <strong>Values</strong>
          </p>
          <ul>
            <li>
              <FeatureStatusDisplay status={FeatureStatus.Supported} /> - The
              feature is fully supported by alphaTab.
            </li>
            <li>
              <FeatureStatusDisplay status={FeatureStatus.Partial} /> - The
              feature is partially supported by alphaTab, hover the item to see
              more details.
            </li>
            <li>
              <FeatureStatusDisplay status={FeatureStatus.NotSupported} /> - The
              feature is not supported by alphaTab.
            </li>
            <li>
              <FeatureStatusDisplay status={FeatureStatus.Ignored} /> - The
              feature is ignored from the input format because it is considered
              not relevant for display or playback. This is opinionated based on the feature set in alphaTab, 
              open a feature request if you need it. 
            </li>
          </ul>
        </Details>
        <Tooltip anchorSelect=".feature-status-cell" />
        <table className="table table-striped table-condensed type-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Data Model</th>
              <th>Reading</th>
              <th>Rendering</th>
              <th>Audio</th>
              <th>alphaTex</th>
            </tr>
          </thead>
          <tbody>{this.props.children}</tbody>
        </table>
      </>
    );
  }
}
