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
import {addLayer, addLayerFeatures, changeLayerProperty, removeLayer, LayerRole} from 'qwc2/actions/layers';
import {setCurrentTask} from 'qwc2/actions/task';
import ResizeableWindow from 'qwc2/components/ResizeableWindow';
import Spinner from 'qwc2/components/Spinner';
import CoordinatesUtils from 'qwc2/utils/CoordinatesUtils';
import LocaleUtils from 'qwc2/utils/LocaleUtils';
import './style/Cyclomedia.css';
import MapUtils from 'qwc2/utils/MapUtils';


const LoadState = {UNLOADED: 0, LOADING: 1, LOADED: 2, ERROR: 3, HAVEPOS: 4};

/**
 * Cyclomedia integration for QWC2.
 */
class Cyclomedia extends React.Component {
    static propTypes = {
        active: PropTypes.bool,
        addLayer: PropTypes.func,
        addLayerFeatures: PropTypes.func,
        /** The Cyclomedia API key */
        apikey: PropTypes.string,
        changeLayerProperty: PropTypes.func,
        click: PropTypes.object,
        /** The cyclomedia version. */
        cyclomediaVersion: PropTypes.string,
        /** Default window geometry. */
        geometry: PropTypes.shape({
            initialWidth: PropTypes.number,
            initialHeight: PropTypes.number,
            initialX: PropTypes.number,
            initialY: PropTypes.number,
            initiallyDocked: PropTypes.bool
        }),
        mapScale: PropTypes.number,
        /** The maximum map scale above which the recordings WFS won't be displayed. */
        maxMapScale: PropTypes.number,
        /** The Cyclomedia password. */
        password: PropTypes.string,
        projection: PropTypes.string,
        removeLayer: PropTypes.func,
        setCurrentTask: PropTypes.func,
        /** The Cyclomedia user name. */
        username: PropTypes.string
    };
    static defaultProps = {
        cyclomediaVersion: '22.17',
        geometry: {
            initialWidth: 480,
            initialHeight: 640,
            initialX: 0,
            initialY: 0,
            initiallyDocked: true
        }
    };
    state = {
        state: LoadState.UNLOADED
    };
    constructor(props) {
        super(props);
        this.iframe = null;
    }
    componentDidUpdate(prevProps) {
        if (!prevProps.active && this.props.active) {
            this.addRecordingsWFS();
            this.setState({state: LoadState.LOADING});
        } else if (prevProps.active && !this.props.active) {
            this.onClose();
        }
        // Handle map click events
        if (this.props.active && this.iframe) {
            const clickPoint = this.queryPoint(prevProps);
            if (clickPoint) {
                const posStr = clickPoint[0] + "," + clickPoint[1];
                this.iframe.contentWindow.openImage(posStr, this.props.projection);
                if (this.state.state === LoadState.LOADED) {
                    this.setState({state: LoadState.HAVEPOS});
                }
            }
        }
        if (this.props.active && this.props.mapScale !== prevProps.mapScale) {
            this.props.changeLayerProperty('cyclomedia-recordings', 'visibility', this.props.mapScale <= this.props.maxMapScale);
        }
    }
    onClose = () => {
        this.props.removeLayer('cyclomedia-recordings');
        this.props.removeLayer('cyclomedia-cone');
        this.props.setCurrentTask(null);
        this.setState({state: LoadState.UNLOADED});
    };
    render() {
        if (!this.props.active) {
            return null;
        }
        return (
            <ResizeableWindow icon="cyclomedia"
                initialHeight={this.props.geometry.initialHeight}
                initialWidth={this.props.geometry.initialWidth}
                initialX={this.props.geometry.initialX}
                initialY={this.props.geometry.initialY}
                initiallyDocked={this.props.geometry.initiallyDocked}
                onClose={this.onClose}
                splitScreenWhenDocked
                title={LocaleUtils.trmsg("cyclomedia.title")}
            >
                <div className="cyclomedia-body" role="body">
                    {this.props.mapScale > this.props.maxMapScale ? (
                        <div className="cyclomedia-scale-hint">
                            {LocaleUtils.tr("cyclomedia.scalehint", this.props.maxMapScale)}
                        </div>
                    ) : null}
                    <iframe className="cyclomedia-frame" onLoad={ev => this.setIframeContent(ev.target)} ref={el => this.pollIframe(el)} />
                    {this.state.state === LoadState.LOADING ? (
                        <div className="cyclomedia-body-overlay">
                            <Spinner /><span>{LocaleUtils.tr("cyclomedia.loading")}</span>
                        </div>
                    ) : null}
                    {this.state.state === LoadState.ERROR ? (
                        <div className="cyclomedia-body-overlay">
                            <span>{LocaleUtils.tr("cyclomedia.loaderror")}</span>
                        </div>
                    ) : null}
                    {this.state.state === LoadState.LOADED ? (
                        <div className="cyclomedia-body-overlay">
                            <span>{LocaleUtils.tr("cyclomedia.clickonmap")}</span>
                        </div>
                    ) : null}
                </div>
            </ResizeableWindow>
        );
    }
    setIframeContent = (iframe) => {
        if (iframe.getAttribute("content-set")) {
            if (!iframe.getAttribute("callback-registered")) {
                iframe.setAttribute("callback-registered", true);
                iframe.contentWindow.registerCallbacks(this.apiInitialized, this.panoramaPositionChanged);
            }
            return;
        }
        iframe.setAttribute("content-set", true);
        iframe.contentWindow.document.open();
        iframe.contentWindow.document.write(this.cyclomediaIndexHtml());
        iframe.contentWindow.document.close();
        this.iframe = iframe;
    };
    pollIframe = (iframe) => {
        if (iframe && !iframe.getAttribute("content-set")) {
            const interval = setInterval(() => {
                if (iframe.getAttribute("content-set")) {
                    return clearInterval(interval);
                }
                if (iframe.contentWindow && iframe.contentWindow.document) {
                    iframe.setAttribute("content-set", true);
                    iframe.contentWindow.document.open();
                    iframe.contentWindow.document.write(this.cyclomediaIndexHtml());
                    iframe.contentWindow.document.close();
                    this.iframe = iframe;
                    clearInterval(interval);
                }
                return true;
            }, 500);
        }
    };
    apiInitialized = (success) => {
        this.setState({state: success ? LoadState.LOADED : LoadState.ERROR});
    };
    panoramaPositionChanged = (posData) => {
        const scale = 50;
        const angle = posData.hFov / 2.0;
        const width = Math.sin(angle);
        const length = Math.sqrt(1.0 - width * width);
        const size = scale / Math.sqrt(width * length);
        const coordinates = [
            [0, 0],
            [size * width * 2, 0],
            [size * width, size * length]
        ];
        const dimensions = [coordinates[1][0] + 0.5, coordinates[2][1] + 0.5];
        const canvas = document.createElement('canvas');
        canvas.width = dimensions[0];
        canvas.height = dimensions[1];
        const context = canvas.getContext('2d');
        context.fillStyle = 'rgba(255, 0, 0, 0.5)';
        context.strokeStyle = '#FF0000';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(coordinates[0][0], coordinates[0][1]);
        coordinates.slice(1).forEach(coo => context.lineTo(coo[0], coo[1]));
        context.closePath();
        context.fill();
        const feature = {
            geometry: {
                type: 'Point',
                coordinates: posData.pos
            },
            crs: posData.crs,
            styleName: 'image',
            styleOptions: {
                img: context.canvas,
                rotation: posData.yaw,
                size: dimensions
            }
        };
        const layer = {
            id: "cyclomedia-cone",
            role: LayerRole.MARKER
        };
        this.props.addLayerFeatures(layer, [feature], true);
    };
    cyclomediaIndexHtml = () => {
        const supportedLang = ["de", "en-GB", "en-US", "fi", "fr", "nl", "tr", "pl"];
        let lang = LocaleUtils.lang();
        if (supportedLang.indexOf(lang) < 0) {
            lang = lang.slice(0, 2);
            if (supportedLang.indexOf(lang) < 0) {
                lang = "en-US";
            }
        }
        return `
            <html>
            <head>
            <script type="text/javascript" src="https://unpkg.com/react@16.12.0/umd/react.production.min.js"></script>
            <script type="text/javascript" src="https://unpkg.com/react-dom@16.12.0/umd/react-dom.production.min.js"></script>
            <script type="text/javascript" src="https://streetsmart.cyclomedia.com/api/v${this.props.cyclomediaVersion}/StreetSmartApi.js?f1733f8beb7131559070"></script>
            <script type="text/javascript">
            let apiInitialized = false;
            let initCallback = null;
            let posCallback = null;

            function initApi() {
                StreetSmartApi.init({
                    targetElement: document.getElementById("streetsmartApi"),
                    username: "${this.props.username}",
                    password: "${this.props.password}",
                    apiKey: "${this.props.apikey}",
                    srs: "EPSG:3857",
                    locale: "${lang}",
                    configurationUrl: 'https://atlas.cyclomedia.com/configuration',
                    addressSettings: {
                        locale: "us",
                        database: "Nokia"
                    }
                }).then(() => {
                    apiInitialized = true;
                    if (initCallback) {
                        initCallback(true);
                    }
                }, () => {
                    apiInitialized = false;
                    if (initCallback) {
                        initCallback(false);
                    }
                });
            }
            function openImage(posStr, crs) {
                if (!apiInitialized) {
                    return;
                }
                StreetSmartApi.open(posStr, {
                    viewerType: StreetSmartApi.ViewerType.PANORAMA,
                    srs: crs,
                    panoramaViewer: {
                         closable: false,
                         maximizable: true,
                         replace: true,
                         recordingsVisible: true,
                         navbarVisible: true,
                         timeTravelVisible: true,
                         measureTypeButtonVisible: true,
                         measureTypeButtonStart: true,
                         measureTypeButtonToggle: true,
                     },
                }).then((result) => {
                    if (result && result[0]){
                        window.panoramaViewer = result[0];
                        window.panoramaViewer.on(StreetSmartApi.Events.panoramaViewer.IMAGE_CHANGE, changeview);
                        window.panoramaViewer.on(StreetSmartApi.Events.panoramaViewer.VIEW_CHANGE, changeview);
                    }          
                }).catch((reason) => {
                    console.log('Failed to create component(s) through API: ' + reason);
                });
            }
            function changeview() {
                if (posCallback) {
                    const recording = window.panoramaViewer.getRecording();
                    const orientation = window.panoramaViewer.getOrientation();
                    const pos = recording.xyz;
                    const posData = {
                        pos: [pos[0], pos[1]],
                        crs: recording.srs,
                        yaw: orientation.yaw * Math.PI / 180,
                        hFov: orientation.hFov * Math.PI / 180.0
                    }
                    posCallback(posData);
                }
            }
            function registerCallbacks(_initCallback, _posCallback) {
                initCallback = _initCallback;
                posCallback = _posCallback;
            }
            </script>
            </head>
            <body onload="initApi()" style="margin: 0">
            <div id="streetsmartApi">
            </div>
            </body>
            </html>
        `;
    };
    addRecordingsWFS = () => {
        const layer = {
            uuid: 'cyclomedia-recordings',
            id: 'cyclomedia-recordings',
            type: 'wfs',
            loader: (vectorSource, extent, resolution, projection, success, failure) => {
                const bbox = CoordinatesUtils.reprojectBbox(extent, projection.getCode(), "EPSG:3857");
                const postData = `
                    <wfs:GetFeature service="WFS" version="1.1.0" resultType="results" outputFormat="text/xml; subtype=gml/3.1.1" xmlns:wfs="http://www.opengis.net/wfs">
                        <wfs:Query typeName="atlas:Recording" srsName="EPSG:3857" xmlns:atlas="http://www.cyclomedia.com/atlas">
                            <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
                                <ogc:And>
                                    <ogc:BBOX>
                                        <gml:Envelope srsName="EPSG:3857" xmlns:gml="http://www.opengis.net/gml">
                                        <gml:lowerCorner>${bbox[0]} ${bbox[1]}</gml:lowerCorner>
                                        <gml:upperCorner>${bbox[2]} ${bbox[3]}</gml:upperCorner>
                                        </gml:Envelope>
                                    </ogc:BBOX>
                                    <ogc:PropertyIsNull>
                                        <ogc:PropertyName>expiredAt</ogc:PropertyName>
                                    </ogc:PropertyIsNull>
                                </ogc:And>
                            </ogc:Filter>
                        </wfs:Query>
                    </wfs:GetFeature>
                `;
                const xhr = new XMLHttpRequest();
                xhr.open('POST', 'https://atlasapi.cyclomedia.com/api/Recordings/wfs');
                xhr.setRequestHeader("Authorization", "Basic " + btoa(this.props.username + ":" + this.props.password));
                const onError = function() {
                    vectorSource.removeLoadedExtent(extent);
                    failure();
                };
                xhr.onerror = onError;
                xhr.onload = function() {
                    if (xhr.status === 200) {
                        const features = vectorSource.getFormat().readFeatures(xhr.responseText);
                        vectorSource.addFeatures(features);
                        success(features);
                    } else {
                        onError();
                    }
                };
                xhr.send(postData);
            },
            name: 'atlas:Recording',
            version: '1.1.0',
            projection: 'EPSG:3857',
            formats: ['text/xml; subtype=gml/3.1.1'],
            invertAxisOrientation: true,
            role: LayerRole.SELECTION,
            color: '#6666FF',
            visibility: this.props.mapScale <= this.props.maxMapScale
        };
        this.props.addLayer(layer);
    };
    queryPoint = (prevProps) => {
        if (this.props.click === prevProps.click)  {
            return null;
        }
        const cmFeature = this.props.click.features.find(feature => feature.layer === 'cyclomedia-recordings');
        return cmFeature ? cmFeature.geometry : null;
    };
}


export default connect((state) => ({
    active: state.task.id === "Cyclomedia",
    click: state.map.click,
    projection: state.map.projection,
    mapScale: MapUtils.computeForZoom(state.map.scales, state.map.zoom)
}), {
    addLayer: addLayer,
    addLayerFeatures: addLayerFeatures,
    changeLayerProperty: changeLayerProperty,
    removeLayer: removeLayer,
    setCurrentTask: setCurrentTask
})(Cyclomedia);
