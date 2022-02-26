import React from 'react';
import styles from './styles.module.scss';

export interface PlayerProgressIndicatorProps {
    percentage: number;
}

export interface PlayerProgressIndicatorState {
}

export class PlayerProgressIndicator extends React.Component<PlayerProgressIndicatorProps, PlayerProgressIndicatorState> {
    public constructor(props: PlayerProgressIndicatorProps) {
        super(props);
    }

    private getLeftRotateTransform() {
        if (this.props.percentage < 0.5) {
            return "rotate(0deg)";
        } else {
            return (
                "rotate(" +
                this.percentageToDegrees(this.props.percentage - 0.5) +
                "deg)"
            );
        }
    }

    private getRightRotateTransform() {
        if (this.props.percentage < 0.5) {
            return (
                "rotate(" + this.percentageToDegrees(this.props.percentage) + "deg)"
            );
        } else {
            return "rotate(180deg)";
        }
    }

    private percentageToDegrees(percentage) {
        return percentage * 360;
    }

    public render() {
        return (
            this.props.percentage < 0.99 && (
                <div className={`${styles['at-player-loading']} ${styles.progress}`}>
                    <span className={styles['progress-left']}>
                        <span
                            className={styles['progress-bar']}
                            style={{ transform: this.getLeftRotateTransform() }}
                        ></span>
                    </span>
                    <span className={styles['progress-right']}>
                        <span
                            className={styles['progress-bar']}
                            style={{ transform: this.getRightRotateTransform() }}
                        ></span>
                    </span>
                    <div className={`${styles['progress-value']} w-100 h-100 rounded-circle d-flex align-items-center justify-content-center font-weight-bold`}>
                        <span className={styles['progress-value-number']}>
                            {(this.props.percentage * 100) | 0}
                        </span>
                        <sup className="small">%</sup>
                    </div>
                </div>
            )
        );
    }
}
