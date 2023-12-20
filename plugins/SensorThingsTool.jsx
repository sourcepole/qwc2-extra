/**
 * Copyright 2023 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import axios from 'axios';
import {Buffer} from 'buffer';
import {
    Chart as ChartJS,
    LinearScale,
    PointElement,
    LineElement,
    Legend,
    Tooltip,
    TimeScale
} from 'chart.js';
import { getRelativePosition } from 'chart.js/helpers';
import 'chartjs-adapter-dayjs-4';
import {Line} from 'react-chartjs-2';
import dayjs from 'dayjs';
import FileSaver from 'file-saver';
import {LayerRole, addLayerFeatures, removeLayer} from 'qwc2/actions/layers';
import {changeSelectionState} from 'qwc2/actions/selection';
import {setCurrentTask} from 'qwc2/actions/task';
import Icon from 'qwc2/components/Icon';
import ResizeableWindow from 'qwc2/components/ResizeableWindow';
import Input from 'qwc2/components/widgets/Input';
import NumberInput from 'qwc2/components/widgets/NumberInput';
import CoordinatesUtils from 'qwc2/utils/CoordinatesUtils';
import LocaleUtils from 'qwc2/utils/LocaleUtils';
import MapUtils from 'qwc2/utils/MapUtils';
import './style/SensorThingsTool.css';


ChartJS.register(
    LinearScale,
    PointElement,
    LineElement,
    Legend,
    Tooltip,
    TimeScale
);

class SensorThingsTool extends React.Component {
    static propTypes = {
        addLayerFeatures: PropTypes.func,
        changeSelectionState: PropTypes.func,
        currentTask: PropTypes.string,
        map: PropTypes.object,
        queryTolerance: PropTypes.number,
        removeLayer: PropTypes.func,
        selection: PropTypes.object,
        sensorThingsApiUrl: PropTypes.string,
        setCurrentTask: PropTypes.func,
        timeFormats: PropTypes.object,
        windowSize: PropTypes.object,
        zoomFactor: PropTypes.number
    };
    static defaultProps = {
        queryTolerance: 16,
        timeFormats: {
            tooltip: 'YYYY-MM-DD HH:mm:ss',
            millisecond: 'HH:mm:ss.SSS',
            second: 'HH:mm:ss',
            minute: 'HH:mm',
            hour: 'HH:mm',
            day: 'MM-DD',
            week: 'YYYY-MM-DD',
            month: 'YYYY-MM',
            quarter: '[Q]Q - YYYY',
            year: 'YYYY'
        },
        windowSize: {width: 800, height: 500},
        zoomFactor: 1.5
    };
    state = {
        /**
         *  sensorLocation = {
         *      id: <Location ID>,
         *      name: <Location name>,
         *      description: <Location description>,
         *      geom: <Location location>
         *      datastreams: [
         *          <Datastream ID>
         *      ]
         *  }
         */
        sensorLocation: null,
        /**
         *  lookup for datastreams by ID
         *
         *  datastreams = {
         *      <Datastream ID>: {
         *          thing: {
         *              name: <Thing name>
         *          },
         *          id: <Datastream ID>,
         *          name: <Datastream name>,
         *          description:<Datastream description>,
         *          unitOfMeasurement: {
         *              name: <unit name>,
         *              symbol: <unit symbol>,
         *              definition: <unit definition>
         *          },
         *          phenomenonTime: <Datastream phenomenonTime time period>,
         *          period: {
         *              start: <period start as Unix timestamp>,
         *              end: <period end as Unix timestamp>
         *          }
         *          link: <datastream @iot.selfLink>
         *      }
         *  }
         */
        datastreams: {},
        /**
         *  graph config and observations of selected datastreams
         *
         *  graph = {
         *      x: {                                                // x-axis config
         *          min: <graph period start as Unix timestamp>,    // null if none
         *          max: <graph period end as Unix timestamp>       // null if none
         *      },
         *      y: {                                                // y-axis config
         *          min: <graph min value>,                         // null if auto
         *          max: <graph max value>                          // null if auto
         *      },
         *      y2: {                                               // second y-axis config
         *          enabled: <whether second y-axis is shown>,
         *          min: <graph min value>,                         // null if auto
         *          max: <graph max value>                          // null if auto
         *          showGrid: <whether grid lines for second y-axis are shown>,
         *      },
         *      datastreams: [
         *          {
         *              id: <selected Datastream ID>,   // "" if none
         *              observations: [                 // null if none
         *                  {
         *                      x: <Observation time as Unix timestamp>,
         *                      y: <Observation value>
         *                  }
         *              ],
         *              loading: <whether Observations are still loading>,
         *              color: [<r>, <g>, <b>]          // line color of this dataset in the graph
         *          }
         *      ]
         *  }
         */
        graph: {
            x: {
                min: null, // Unix timestamp
                max: null // Unix timestamp
            },
            y: {
                min: null,
                max: null
            },
            y2: {
                enabled: false,
                min: null,
                max: null,
                showGrid: true
            },
            datastreams: [
                {
                    id: "",
                    observations: null,
                    loading: false,
                    color: [54, 162, 235]
                },
                {
                    id: "",
                    observations: null,
                    loading: false,
                    color: [255, 99, 132]
                }
            ]
        },
        // current time slider value as Unix timestamp
        timeSliderValue: null,
        // selected interval preset in ms (-1 if not set)
        selectedInterval: -1,
        // true if graph options are shown
        graphOptionsPopup: false
    };
    constructor(props) {
        super(props);
        this.chartRef = null;
        this.setupChartMouseZoom();
    }
    componentDidUpdate(prevProps, prevState) {
        if (this.props.currentTask === 'SensorThingsTool' && prevProps.currentTask !== 'SensorThingsTool') {
            this.activated();
        } else if (this.props.currentTask !== 'SensorThingsTool' && prevProps.currentTask === 'SensorThingsTool') {
            this.deactivated();
        } else if (this.props.currentTask === 'SensorThingsTool' && this.props.selection.point &&
            this.props.selection !== prevProps.selection) {
            this.queryAtPoint(this.props.selection.point);
        }

        if (this.state.sensorLocation && this.state.sensorLocation !== prevState.sensorLocation) {
            // highlight current Location
            const layer = {
                id: "sensorThingsSelection",
                role: LayerRole.SELECTION
            };
            const feature = {
                type: 'Feature',
                geometry: this.state.sensorLocation.geom,
                crs: 'EPSG:4326',
                styleName: 'default',
                styleOptions: {
                    fillColor: [0, 0, 0, 0],
                    strokeColor: [242, 151, 84, 0.75],
                    strokeWidth: 4,
                    circleRadius: 10
                }
            };
            this.props.addLayerFeatures(layer, [feature], true);
        } else if (prevState.sensorLocation && !this.state.sensorLocation) {
            this.props.removeLayer("sensorThingsSelection");
        }

        const graphPeriodChanged = (this.state.graph.x.min !== prevState.graph.x.min || this.state.graph.x.max !== prevState.graph.x.max);
        this.state.graph.datastreams.forEach((datastream, idx) => {
            if (datastream.id && !datastream.loading && (datastream.observations === null || graphPeriodChanged)) {
                this.loadDatastreamObservations(idx, datastream.id);
            }
        });
        if (this.state.graph.x.min !== prevState.graph.x.min) {
            const periodBegin = this.state.graph.x.min;
            if (this.state.timeSliderValue !== periodBegin) {
                this.setState({timeSliderValue: periodBegin});
            }
        }
        if (graphPeriodChanged) {
            const interval = this.state.graph.x.max - this.state.graph.x.min;
            if (this.state.selectedInterval !== interval) {
                this.setState({selectedInterval: interval});
            }
        }
    }
    render() {
        if (!this.state.sensorLocation) {
            return null;
        }

        return (
            <ResizeableWindow icon="sensor_things" initialHeight={this.props.windowSize.height}
                initialWidth={this.props.windowSize.width} initialX={0}
                initialY={0} onClose={() => this.props.setCurrentTask(null)}
                title="sensorthingstool.title"
            >
                {this.renderBody()}
            </ResizeableWindow>
        );
    }
    renderBody = () => {
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            // NOTE: requires sorted data and as Unix timestamps
            parsing: false,
            plugins: {
                legend: {
                    position: 'top'
                },
                mouseZoomPlugin: {
                    events: ['mousemove', 'mouseout', 'mousedown', 'mouseup', 'touchmove', 'touchstart', 'touchend']
                }
            },
            events: ['mousemove', 'mouseout', 'mousedown', 'mouseup', 'click', 'touchmove', 'touchstart', 'touchend'],
            scales: {
                x: {
                    type: 'time',
                    min: this.state.graph.x.min,
                    max: this.state.graph.x.max,
                    time: {
                        tooltipFormat: this.props.timeFormats.tooltip,
                        displayFormats: this.props.timeFormats
                    }
                },
                y: {
                    type: 'linear',
                    min: this.state.graph.y.min,
                    max: this.state.graph.y.max
                }
            }
        };
        const data = {
            datasets: []
        };

        const periodBegin = dayjs(this.state.graph.x.min);
        const periodEnd = dayjs(this.state.graph.x.max);

        let yUnit = null;
        let yRightUnit = null;
        let fullDatastreamsPeriodBegin = null;
        let fullDatastreamsPeriodEnd = null;
        this.state.graph.datastreams.forEach((datastream, idx) => {
            if (datastream.observations) {
                const datastreamInfo = this.state.datastreams[datastream.id];
                // add Observations dataset
                const dataset = {
                    label: datastreamInfo.description,
                    data: datastream.observations,
                    borderColor: `rgb(${datastream.color.join(',')})`,
                    backgroundColor: `rgba(${datastream.color.join(',')},0.5)`,
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                const value = context.formattedValue;
                                if (value !== null) {
                                    label += value;
                                    const unit = datastreamInfo.unitOfMeasurement.symbol;
                                    if (unit !== null) {
                                        // append Datastream unit to value
                                        label += ' ' + unit;
                                    }
                                }
                                return label;
                            }
                        }
                    },
                    yAxisID: 'y'
                };

                if (this.state.graph.y2.enabled) {
                    // set target y-axis
                    dataset.yAxisID = (idx === 1) ? 'yRight' : 'y';

                    // collect units for y-axis titles
                    const unit = datastreamInfo.unitOfMeasurement.symbol;
                    if (idx === 0) {
                        yUnit = unit;
                    } else if (idx === 1) {
                        yRightUnit = unit;
                    }
                }

                // collect combined period
                fullDatastreamsPeriodBegin = Math.min(datastreamInfo.period.begin, fullDatastreamsPeriodBegin || datastreamInfo.period.begin);
                fullDatastreamsPeriodEnd = Math.max(datastreamInfo.period.end, fullDatastreamsPeriodEnd || datastreamInfo.period.end);

                data.datasets.push(dataset);
            }
        });

        if (this.state.graph.y2.enabled) {
            // add right y-axis
            options.scales.yRight = {
                type: 'linear',
                position: 'right',
                display: 'auto',
                min: this.state.graph.y2.min,
                max: this.state.graph.y2.max,
                grid: {
                    drawOnChartArea: this.state.graph.y2.showGrid
                },
                border: {
                    dash: [4, 4]
                }
            };

            // set y-axis titles
            if (yUnit !== null) {
                options.scales.y.title = {
                    text: yUnit,
                    display: true
                };
            }
            if (yRightUnit !== null) {
                options.scales.yRight.title = {
                    text: yRightUnit,
                    display: true
                };
            }
        }

        const intervalOptions = [
            {label: LocaleUtils.tr("sensorthingstool.intervalOptions.custom"), interval: -1}, // custom
            {label: LocaleUtils.tr("sensorthingstool.intervalOptions.hour"), interval: 3600000}, // 3600 * 1000 ms
            {label: LocaleUtils.tr("sensorthingstool.intervalOptions.day"), interval: 86400000}, // 24 * 3600 * 1000 ms
            {label: LocaleUtils.tr("sensorthingstool.intervalOptions.week"), interval: 604800000}, // 7 * 24 * 3600 * 1000 ms
            {label: LocaleUtils.tr("sensorthingstool.intervalOptions.month"), interval: 2678400000}, // 31 * 24 * 3600 * 1000 ms
            {label: LocaleUtils.tr("sensorthingstool.intervalOptions.year"), interval: 31536000000} // 365 * 24 * 3600 * 1000 ms
        ];

        const graphOptions = this.state.graphOptionsPopup ? (
            <div className="sensor-things-graph-options">
                <table>
                    <tbody>
                        <tr>
                            <td><b>{LocaleUtils.tr("sensorthingstool.graphOptions.yAxis")}</b></td>
                            {this.state.graph.y2.enabled ? (<td />) : null}
                            <td>
                                <label><input checked={this.state.graph.y2.enabled} onChange={(ev) => this.updateGraphAxis('y2', {enabled: ev.target.checked})} type="checkbox"  /> {LocaleUtils.tr("sensorthingstool.graphOptions.toggleSecondYAxis")}</label>
                            </td>
                        </tr>
                        <tr>
                            <td>{LocaleUtils.tr("sensorthingstool.graphOptions.yMax")}:</td>
                            <td>
                                <NumberInput decimals={3} onChange={value => this.updateGraphAxis('y', {max: value})} placeholder={LocaleUtils.tr("sensorthingstool.graphOptions.yAuto")} value={this.state.graph.y.max} />
                                <button className={"button reset-button"} onClick={() => this.updateGraphAxis('y', {max: null})}>
                                    <Icon icon="clear" />
                                </button>
                            </td>
                            {this.state.graph.y2.enabled ? (
                                <td>
                                    <NumberInput decimals={3} onChange={value => this.updateGraphAxis('y2', {max: value})} placeholder={LocaleUtils.tr("sensorthingstool.graphOptions.yAuto")} value={this.state.graph.y2.max} />
                                    <button className={"button reset-button"} onClick={() => this.updateGraphAxis('y2', {max: null})}>
                                        <Icon icon="clear" />
                                    </button>
                                </td>
                            ) : null}
                        </tr>
                        <tr>
                            <td>{LocaleUtils.tr("sensorthingstool.graphOptions.yMin")}:</td>
                            <td>
                                <NumberInput decimals={3} onChange={value => this.updateGraphAxis('y', {min: value})} placeholder={LocaleUtils.tr("sensorthingstool.graphOptions.yAuto")} value={this.state.graph.y.min} />
                                <button className={"button reset-button"} onClick={() => this.updateGraphAxis('y', {min: null})}>
                                    <Icon icon="clear" />
                                </button>
                            </td>
                            {this.state.graph.y2.enabled ? (
                                <td>
                                    <NumberInput decimals={3} onChange={value => this.updateGraphAxis('y2', {min: value})} placeholder={LocaleUtils.tr("sensorthingstool.graphOptions.yAuto")} value={this.state.graph.y2.min} />
                                    <button className={"button reset-button"} onClick={() => this.updateGraphAxis('y2', {min: null})}>
                                        <Icon icon="clear" />
                                    </button>
                                </td>
                            ) : null}
                        </tr>
                        {this.state.graph.y2.enabled ? (
                            <tr>
                                <td />
                                <td />
                                <td>
                                    <label><input checked={this.state.graph.y2.showGrid} onChange={(ev) => this.updateGraphAxis('y2', {showGrid: ev.target.checked})} type="checkbox" /> {LocaleUtils.tr("sensorthingstool.graphOptions.toggleGridLines")}</label>
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>
        ) : null;

        return (
            <div className="sensor-things-dialog-body" role="body">
                <div className="sensor-things-location">
                    <div className="sensor-things-location-info">
                        <b>{this.state.sensorLocation.name}</b> {this.state.sensorLocation.description}
                    </div>
                    {this.state.graph.datastreams.map((graphDatastreamState, datastreamIndex) => (
                        <div key={"sensor-things-select-datastream-" + datastreamIndex}>
                            {LocaleUtils.tr("sensorthingstool.datastreamLabel")} {datastreamIndex + 1}:&nbsp;
                            <select onChange={(ev) => this.updateDatastream(datastreamIndex, parseInt(ev.target.value, 10) || "")} value={graphDatastreamState.id}>
                                <option key={"sensor-things-select-datastream-" + datastreamIndex + "-none"} value="">{LocaleUtils.tr("sensorthingstool.datastreamSelectNone")}</option>
                                {this.state.sensorLocation.datastreams.map((datastreamId, idx) => {
                                    const datastream = this.state.datastreams[datastreamId];
                                    return (
                                        <option key={"sensor-things-select-datastream-" + datastreamIndex + "-" + idx} value={datastream.id}>{datastream.description}</option>
                                    );
                                })}
                            </select>
                        </div>
                    ))}
                </div>
                <div className="sensor-things-graph">
                    <Line data={data} options={options} ref={el => { this.chartRef = el; }} />
                </div>
                <div className="sensor-things-graph-controls">
                    {this.renderTimeSlider(fullDatastreamsPeriodBegin, fullDatastreamsPeriodEnd)}

                    <div className="sensor-things-toolbar">
                        <Input onChange={this.updatePeriodBeginDate} type="date" value={periodBegin.format('YYYY-MM-DD')} />
                        <Input onChange={this.updatePeriodBeginTime} type="time" value={periodBegin.format('HH:mm')} />

                        <div className="sensor-things-toolbar-spacer" />

                        <button className="button" onClick={this.updatePeriodIntervalAfterBegin}>
                            <Icon icon="after" />
                        </button>
                        <select onChange={(ev) => this.setState({selectedInterval: parseInt(ev.target.value, 10)})} value={this.state.selectedInterval}>
                            {intervalOptions.map((interval, idx) => {
                                return (
                                    <option key={"sensor-things-select-interval-" + idx} value={interval.interval}>{interval.label}</option>
                                );
                            })}
                        </select>
                        <button className="button" onClick={this.updatePeriodIntervalBeforeEnd}>
                            <Icon icon="before" />
                        </button>

                        <div className="sensor-things-toolbar-spacer-small" />

                        <button className="button" onClick={this.updatePeriodPrevInterval}>
                            <Icon icon="nav-left" />
                        </button>
                        <button className="button" onClick={this.updatePeriodNextInterval}>
                            <Icon icon="nav-right" />
                        </button>
                        <button className="button" onClick={this.updatePeriodNow}>
                            <Icon icon="today" />
                        </button>

                        <div className="sensor-things-toolbar-spacer-small" />

                        <button className="button" onClick={this.zoomIn} title={LocaleUtils.tr("sensorthingstool.zoomIn")}>
                            <Icon icon="zoomin" />
                        </button>
                        <button className="button" onClick={this.zoomOut} title={LocaleUtils.tr("sensorthingstool.zoomOut")}>
                            <Icon icon="zoomout" />
                        </button>

                        <div className="sensor-things-toolbar-spacer-small" />

                        <button className="button" onClick={this.exportCSV} title={LocaleUtils.tr("sensorthingstool.exportCSV")}>
                            <Icon icon="export" />
                        </button>
                        <button className="button" onClick={this.exportImage} title={LocaleUtils.tr("sensorthingstool.exportImage")}>
                            <Icon icon="rasterexport" />
                        </button>

                        <div className="sensor-things-toolbar-spacer-small" />

                        <div>
                            <button className={"button" + (this.state.graphOptionsPopup ? " pressed" : "")} onClick={() => this.setState((state) => ({graphOptionsPopup: !state.graphOptionsPopup}))}>
                                <Icon icon="cog" />
                            </button>
                            {graphOptions}
                        </div>

                        <div className="sensor-things-toolbar-spacer" />

                        <Input onChange={this.updatePeriodEndDate} type="date" value={periodEnd.format('YYYY-MM-DD')} />
                        <Input onChange={this.updatePeriodEndTime} type="time" value={periodEnd.format('HH:mm')} />
                    </div>
                </div>
            </div>
        );
    };
    renderTimeSlider = (fullDatastreamsPeriodBegin, fullDatastreamsPeriodEnd) => {
        const timeSliderBegin = fullDatastreamsPeriodBegin;
        const timeSliderEnd = fullDatastreamsPeriodEnd;
        // set step size to 24h
        const timeSliderStep = 86400000; // 24 * 3600 * 1000

        return (
            <div className="sensor-things-timeslider">
                <input max={timeSliderEnd} min={timeSliderBegin} onChange={(ev) => this.setState({timeSliderValue: parseInt(ev.target.value, 10)})} onKeyUp={this.updatePeriodFromTimeSlider} onMouseUp={this.updatePeriodFromTimeSlider} onTouchEnd={this.updatePeriodFromTimeSlider} step={timeSliderStep} type="range" value={this.state.timeSliderValue} />
                <span className="sensor-things-timeslider-tooltip">
                    {dayjs(this.state.timeSliderValue).format(this.props.timeFormats.tooltip)}
                </span>
            </div>
        );
    };
    updateDatastream = (datastreamIndex, datastreamId) => {
        if (datastreamId !== this.state.graph.datastreams[datastreamIndex].id) {
            this.setState((state) => ({
                graph: {
                    ...state.graph,
                    datastreams: state.graph.datastreams.map((datastream, idx) => {
                        if (idx === datastreamIndex) {
                            return {
                                ...datastream,
                                id: datastreamId,
                                // clear observations
                                observations: null,
                                loading: false
                            };
                        }
                        return datastream;
                    })
                }
            }));
        }
    };
    activated = () => {
        this.props.changeSelectionState({geomType: 'Point', style: 'default', styleOptions: {
            fillColor: [0, 0, 0, 0],
            strokeColor: [0, 0, 0, 0]
        }, cursor: 'crosshair'});
        this.initPeriod();
    };
    deactivated = () => {
        this.clearObservations();
        this.setState({sensorLocation: null, datastreams: {}});
        this.props.changeSelectionState({geomType: null});
    };
    initPeriod = () => {
        if (this.state.graph.x.min === null) {
            // set initial default period to the last 24h
            const now = Date.now();
            this.updateGraphAxis('x', {
                min: now - 24 * 3600 * 1000,
                max: now
            });
        }
    };
    queryAtPoint = (point) => {
        // clear previous observations
        this.clearObservations();

        // calculate BBox for tolerance in pixels, in local SRS
        const resolution = MapUtils.computeForZoom(this.props.map.resolutions, this.props.map.zoom);
        const dx = this.props.queryTolerance * resolution;
        const dy = dx;
        const bbox = [point[0] - dx, point[1] - dy, point[0] + dx, point[1] + dy];
        // transform BBox to WGS84 coords
        const wgs84Bbox = CoordinatesUtils.reprojectBbox(bbox, this.props.map.projection, 'EPSG:4326');
        const wgs84Point = CoordinatesUtils.reprojectBbox(point, this.props.map.projection, 'EPSG:4326');
        // build WKT string for BBox (limit coord precision to ~3cm)
        const minX = wgs84Bbox[0].toFixed(6);
        const minY = wgs84Bbox[1].toFixed(6);
        const maxX = wgs84Bbox[2].toFixed(6);
        const maxY = wgs84Bbox[3].toFixed(6);
        const wgs84Wkt = `POLYGON((${minX} ${minY},${maxX} ${minY},${maxX} ${maxY},${minX} ${maxY},${minX} ${minY}))`;

        // query SensorThings API for Locations within BBox
        const url = this.props.sensorThingsApiUrl.replace(/\/$/, '') + '/Locations';
        const params = {
            $filter: "st_intersects(location, geography'" + wgs84Wkt + "')",
            $expand: "Things($expand=Datastreams)"
        };

        axios.get(url, {params}).then(response => {
            if (response.data.value.length === 0) {
                // no Location found
                this.setState({sensorLocation: null, datastreams: {}});
                return;
            }

            // find Location closest to query pos
            let closestLocation = response.data.value[0];
            if (response.data.value.length > 1) {
                let minDistSquared = 99999;
                response.data.value.forEach((location) => {
                    if (location.location.type === 'Point') {
                        const x = location.location.coordinates[0];
                        const y = location.location.coordinates[1];
                        const distSquared = (wgs84Point[0] - x) ** 2 + (wgs84Point[1] - y) ** 2;
                        if (distSquared < minDistSquared) {
                            closestLocation = location;
                            minDistSquared = distSquared;
                        }
                    }
                    // ignore if not a point geom
                });
            }

            // collect flat list of Datastreams of all Things of this Location
            const datastreamIds = [];
            const datastreamsLookup = {};
            closestLocation.Things.forEach((thing) => {
                thing.Datastreams.forEach((datastream) => {
                    const datastreamId = datastream['@iot.id'];
                    datastreamIds.push(datastreamId);

                    // parse period from phenomenonTime as Unix timestamps
                    // e.g. "2023-09-19T07:01:00Z/2023-09-19T15:21:00Z"
                    //      -> 1695106860000, 1695136860000
                    let periodBegin = null;
                    let periodEnd = null;
                    if (datastream.phenomenonTime) {
                        const parts = datastream.phenomenonTime.split('/');
                        periodBegin = Date.parse(parts[0]);
                        periodEnd = Date.parse(parts[1]);
                    }

                    datastreamsLookup[datastreamId] = {
                        thing: {
                            name: thing.name
                        },
                        id: datastreamId,
                        name: datastream.name,
                        description: datastream.description,
                        unitOfMeasurement: datastream.unitOfMeasurement,
                        phenomenonTime: datastream.phenomenonTime,
                        period: {
                            begin: periodBegin,
                            end: periodEnd
                        },
                        link: datastream['@iot.selfLink']
                    };
                });
            });

            this.setState({
                sensorLocation: {
                    id: closestLocation['@iot.id'],
                    name: closestLocation.name,
                    description: closestLocation.description,
                    geom: closestLocation.location,
                    datastreams: datastreamIds
                },
                datastreams: datastreamsLookup
            });

            // auto select first datastream
            this.updateDatastream(0, datastreamIds[0]);
        }).catch(e => {
            // eslint-disable-next-line
            console.warn("SensorThings API locations query failed:", e.message);
            this.setState({sensorLocation: null, datastreams: {}});
        });
    };
    loadDatastreamObservations = (datastreamIndex, datastreamId) => {
        // mark as loading
        this.setState((state) => ({
            graph: {
                ...state.graph,
                datastreams: state.graph.datastreams.map((datastream, idx) => {
                    if (idx === datastreamIndex) {
                        return {
                            ...datastream,
                            loading: true
                        };
                    }
                    return datastream;
                })
            }
        }));

        const limit = 10000;

        // get Observations within selected graph period
        const datastream = this.state.datastreams[datastreamId];
        const filterPeriodStart = dayjs(this.state.graph.x.min).toISOString();
        const filterPeriodEnd = dayjs(this.state.graph.x.max).toISOString();
        const filter = `phenomenonTime ge ${filterPeriodStart} and phenomenonTime le ${filterPeriodEnd}`;

        this.loadObservations(datastreamIndex, datastreamId, datastream.link.replace(/\/$/, '') + '/Observations', limit, 0, filter, []);
    };
    // load obervations with pagination
    loadObservations = (datastreamIndex, datastreamId, observationsUrl, limit, skip, filter, observations) => {
        const params = {
            $select: "phenomenonTime,result",
            $orderby: "phenomenonTime asc",
            $top: limit,
            $skip: skip
        };
        if (filter) {
            params.$filter = filter;
        }
        axios.get(observationsUrl, {params}).then(response => {
            if (datastreamId !== this.state.graph.datastreams[datastreamIndex].id) {
                // skip results, as a different Datastream has been selected in the meantime while this request was still loading
                return;
            }

            // add current batch to observations
            observations = observations.concat(response.data.value);

            if (response.data['@iot.nextLink']) {
                // load next batch
                this.loadObservations(datastreamIndex, datastreamId, observationsUrl, limit, skip + response.data.value.length, filter, observations);
            } else {
                // update datastream observations and reset loading
                this.setState((state) => ({
                    graph: {
                        ...state.graph,
                        datastreams: state.graph.datastreams.map((datastream, idx) => {
                            if (idx === datastreamIndex) {
                                return {
                                    ...datastream,
                                    // convert to dataset data for Chart.js
                                    observations: observations.map((observation) => ({
                                        // NOTE: phenomenonTime may be a time instant or period
                                        //       e.g. "2023-11-01T09:00:00Z"
                                        //       e.g. "2023-11-01T09:00:00Z/2023-11-01T10:00:00Z"
                                        // NOTE: convert to Unix timestamps for better performance
                                        x: Date.parse(observation.phenomenonTime.split('/')[0]),
                                        y: observation.result
                                    })),
                                    loading: false
                                };
                            }
                            return datastream;
                        })
                    }
                }));
            }
        }).catch(e => {
            // eslint-disable-next-line
            console.warn("SensorThings API observations query failed:", e.message);
        });
    };
    // clear all datastream observations
    clearObservations = () => {
        this.state.graph.datastreams.forEach((datastream, idx) => {
            this.updateDatastream(idx, "");
        });
    };
    updatePeriodBeginDate = (dateString) => {
        if (dateString) {
            this.updateGraphAxis('x', {min: this.timestampAtDate(this.state.graph.x.min, dateString)});
        }
    };
    updatePeriodBeginTime = (timeString) => {
        if (timeString) {
            this.updateGraphAxis('x', {min: this.timestampAtTime(this.state.graph.x.min, timeString)});
        }
    };
    updatePeriodEndDate = (dateString) => {
        if (dateString) {
            this.updateGraphAxis('x', {max: this.timestampAtDate(this.state.graph.x.max, dateString)});
        }
    };
    updatePeriodEndTime = (timeString) => {
        if (timeString) {
            this.updateGraphAxis('x', {max: this.timestampAtTime(this.state.graph.x.max, timeString)});
        }
    };
    updatePeriodFromTimeSlider = (timestamp) => {
        // move current interval to begin at new timestamp from time slider
        const interval = this.state.graph.x.max - this.state.graph.x.min;
        this.updateGraphAxis('x', {min: this.state.timeSliderValue, max: this.state.timeSliderValue + interval});
    };
    updatePeriodIntervalAfterBegin = () => {
        if (this.state.selectedInterval !== -1) {
            // update period end for selected interval after current period start
            this.updateGraphAxis('x', {max: this.state.graph.x.min + this.state.selectedInterval});
        }
    };
    updatePeriodIntervalBeforeEnd = () => {
        if (this.state.selectedInterval !== -1) {
            // update period begin for selected interval before current period end
            this.updateGraphAxis('x', {min: this.state.graph.x.max - this.state.selectedInterval});
        }
    };
    updatePeriodPrevInterval = () => {
        const interval = this.state.graph.x.max - this.state.graph.x.min;
        this.updateGraphAxis('x', {min: this.state.graph.x.min - interval, max: this.state.graph.x.max - interval});
    };
    updatePeriodNextInterval = () => {
        const interval = this.state.graph.x.max - this.state.graph.x.min;
        this.updateGraphAxis('x', {min: this.state.graph.x.min + interval, max: this.state.graph.x.max + interval});
    };
    updatePeriodNow = () => {
        const interval = this.state.graph.x.max - this.state.graph.x.min;
        const now = Date.now();
        this.updateGraphAxis('x', {min: now - interval, max: now});
    };
    zoomIn = () => {
        // zoom in at middle of current interval
        const interval = this.state.graph.x.max - this.state.graph.x.min;
        const intervalDelta = interval * (1.0 - 1.0 / this.props.zoomFactor);
        const periodBegin = this.state.graph.x.min + intervalDelta / 2.0;
        const periodEnd = this.state.graph.x.max - intervalDelta / 2.0;
        this.updateGraphAxis('x', {min: periodBegin, max: periodEnd});
    };
    zoomOut = () => {
        // zoom out from middle of current interval
        const interval = this.state.graph.x.max - this.state.graph.x.min;
        const intervalDelta = interval * (this.props.zoomFactor - 1.0);
        const periodBegin = this.state.graph.x.min - intervalDelta / 2.0;
        const periodEnd = this.state.graph.x.max + intervalDelta / 2.0;
        this.setState((state) => ({
            graph: {
                ...state.graph,
                x: {
                    ...state.graph.x,
                    min: periodBegin,
                    max: periodEnd
                },
                // NOTE: reset range of y-axes to auto
                y: {
                    ...state.graph.y,
                    min: null,
                    max: null
                },
                y2: {
                    ...state.graph.y2,
                    min: null,
                    max: null
                }
            }
        }));
    };
    // return timestamp with new date part
    // dateString = "<YYYY-MM-DD>"
    timestampAtDate = (timestamp, dateString) => {
        const newDate = dayjs(dateString, "YYYY-MM-DD");
        return dayjs(timestamp).year(newDate.year()).month(newDate.month()).date(newDate.date()).valueOf();
    };
    // return timestamp with new time part
    // timeString = "<HH:mm>"
    timestampAtTime = (timestamp, timeString) => {
        const parts = timeString.split(":").map(value => parseInt(value, 10));
        return dayjs(timestamp).hour(parts[0]).minute(parts[1]).second(0).millisecond(0).valueOf();
    };
    updateGraphAxis = (axis, diff) => {
        this.setState((state) => ({
            graph: {
                ...state.graph,
                [axis]: {
                    ...state.graph[axis],
                    ...diff
                }
            }
        }));
    };
    exportCSV = () => {
        if (!this.state.sensorLocation) {
            return;
        }

        let csvLines = [];
        csvLines.push(["locationID", "locationName", "datastreamID", "datastreamName", "timestamp", "timestring", "value", "unit"]);
        this.state.graph.datastreams.forEach((datastream) => {
            if (datastream.observations) {
                const datastreamInfo = this.state.datastreams[datastream.id];

                // NOTE: wrap text values in double quotes for escaping
                csvLines = csvLines.concat(datastream.observations.map((observation) => [
                    this.state.sensorLocation.id,
                    `"${this.state.sensorLocation.name.replace('"', '""')}"`,
                    datastreamInfo.id,
                    `"${datastreamInfo.name.replace('"', '""')}"`,
                    // observation time as Unix timestamp in seconds
                    observation.x / 1000,
                    // observation time as ISO8601 string
                    dayjs(observation.x).format(),
                    observation.y,
                    `"${datastreamInfo.unitOfMeasurement.symbol.replace('"', '""')}"`
                ]));
            }
        });
        if (csvLines.length < 2) {
            // no observations present
            return;
        }

        const csv = csvLines.map((csvLine) => csvLine.join(";")).join("\n");
        FileSaver.saveAs(new Blob([csv], {type: "text/csv;charset=utf-8"}), "sensor_observations.csv");
    };
    exportImage = () => {
        if (!this.state.sensorLocation) {
            return;
        }

        const imgBase64 = this.chartRef.toBase64Image('image/png');

        // parse base64 string, e.g. "data:image/png;base64,abcd1234..."
        const parts = imgBase64.split(',');
        const imgData = new Buffer(parts[1], "base64");
        const imgType = parts[0].split(':')[1].split(';')[0];

        FileSaver.saveAs(new Blob([imgData], {type: imgType}), "sensor_observations.png");
    };
    setupChartMouseZoom = () => {
        const mouseZoomPlugin = {
            id: 'mouseZoomPlugin',
            beforeEvent(chart, args) {
                const event = args.event;
                if (event.type === 'mousedown') {
                    // start drawing zoom rect
                    const canvasPosition = getRelativePosition(event, chart);
                    this.drawing = true;
                    this.drawStart = {
                        x: canvasPosition.x,
                        y: canvasPosition.y
                    };
                    this.drawEnd = null;
                } else if (event.type === 'mousemove') {
                    if (this.drawing) {
                        // update zoom rect while drawing
                        const canvasPosition = getRelativePosition(event, chart);
                        this.drawEnd = {
                            x: canvasPosition.x,
                            y: canvasPosition.y
                        };
                        chart.draw();
                    }
                } else if (event.type === 'mouseup') {
                    if (this.drawing) {
                        if (this.drawEnd === null) {
                            // skip if no zoom rect yet
                            this.drawing = false;
                            return;
                        }

                        // zoom to rect after finishing drawing

                        // calc axis ranges from rect
                        const periodBegin = chart.scales.x.getValueForPixel(Math.min(this.drawStart.x, this.drawEnd.x));
                        const periodEnd = chart.scales.x.getValueForPixel(Math.max(this.drawStart.x, this.drawEnd.x));
                        const minY = chart.scales.y.getValueForPixel(Math.max(this.drawStart.y, this.drawEnd.y));
                        const maxY = chart.scales.y.getValueForPixel(Math.min(this.drawStart.y, this.drawEnd.y));
                        let minY2 = null;
                        let maxY2 = null;
                        if (this.component.state.graph.y2.enabled) {
                            minY2 = chart.scales.yRight.getValueForPixel(Math.max(this.drawStart.y, this.drawEnd.y));
                            maxY2 = chart.scales.yRight.getValueForPixel(Math.min(this.drawStart.y, this.drawEnd.y));
                        }

                        // clear zoom rect
                        this.drawing = false;
                        this.drawStart = null;
                        this.drawEnd = null;
                        chart.draw();

                        // zoom to selected range
                        this.component.setState((state) => ({
                            graph: {
                                ...state.graph,
                                x: {
                                    ...state.graph.x,
                                    min: periodBegin,
                                    max: periodEnd
                                },
                                y: {
                                    ...state.graph.y,
                                    min: minY,
                                    max: maxY
                                },
                                y2: {
                                    ...state.graph.y2,
                                    min: minY2,
                                    max: maxY2
                                }
                            }
                        }));
                    }
                } else if (event.type === 'mouseout') {
                    // abort drawing rect

                    // clear zoom rect
                    this.drawing = false;
                    this.drawStart = null;
                    this.drawEnd = null;
                    chart.draw();
                }
            },
            afterDraw(chart) {
                if (!this.drawing || this.drawStart === null || this.drawEnd === null) {
                    return;
                }

                // draw zoom rect
                const {ctx} = chart;
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = '#595959';
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.strokeRect(this.drawStart.x, this.drawStart.y, this.drawEnd.x - this.drawStart.x, this.drawEnd.y - this.drawStart.y);
                ctx.restore();
            },
            drawing: false,
            drawStart: null,
            drawEnd: null,
            component: this
        };
        ChartJS.register(mouseZoomPlugin);
    };
}

const selector = state => ({
    selection: state.selection,
    map: state.map,
    currentTask: state.task.id
});

export default connect(
    selector,
    {
        changeSelectionState: changeSelectionState,
        setCurrentTask: setCurrentTask,
        addLayerFeatures: addLayerFeatures,
        removeLayer: removeLayer
    }
)(SensorThingsTool);
