/**
 * Copyright 2019-2021 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import isEmpty from 'lodash.isempty';
import axios from 'axios';
import FileSaver from 'file-saver';
import {logAction} from 'qwc2/actions/logging';
import ConfigUtils from 'qwc2/utils/ConfigUtils';
import {changeSelectionState} from 'qwc2/actions/selection';
import {clearSearch} from 'qwc2/actions/search';
import {setCurrentTask} from 'qwc2/actions/task';
import {LayerRole, addThemeSublayer, addLayerFeatures, removeLayer} from 'qwc2/actions/layers';
import ResizeableWindow from 'qwc2/components/ResizeableWindow';
import Spinner from 'qwc2/components/Spinner';
import Icon from 'qwc2/components/Icon';
import {zoomToPoint} from 'qwc2/actions/map';
import {UrlParams} from 'qwc2/utils/PermaLinkUtils';
import CoordinatesUtils from 'qwc2/utils/CoordinatesUtils';
import LocaleUtils from 'qwc2/utils/LocaleUtils';
import MapUtils from 'qwc2/utils/MapUtils';
import VectorLayerUtils from 'qwc2/utils/VectorLayerUtils';
import './style/PlotInfoTool.css';


class PlotInfoTool extends React.Component {
    static propTypes = {
        addLayerFeatures: PropTypes.func,
        addThemeSublayer: PropTypes.func,
        changeSelectionState: PropTypes.func,
        clearSearch: PropTypes.func,
        currentTask: PropTypes.string,
        customInfoComponents: PropTypes.object,
        infoQueries: PropTypes.array,
        logAction: PropTypes.func,
        map: PropTypes.object,
        removeLayer: PropTypes.func,
        selection: PropTypes.object,
        setCurrentTask: PropTypes.func,
        theme: PropTypes.object,
        themeLayerRestorer: PropTypes.func,
        toolLayers: PropTypes.array,
        windowSize: PropTypes.object,
        zoomToPoint: PropTypes.func
    };
    static defaultProps = {
        toolLayers: [],
        infoQueries: [],
        customInfoComponents: {},
        windowSize: {width: 500, height: 800}
    };
    state = {
        plotInfo: null,
        currentPlot: null,
        expandedInfo: null,
        expandedInfoData: null,
        pendingPdfs: []
    };
    componentDidUpdate(prevProps, prevState) {
        if (this.props.theme && !prevProps.theme) {
            if (UrlParams.getParam('realty') !== undefined) {
                this.props.setCurrentTask('PlotInfoTool');
            } else {
                for (const entry of this.props.infoQueries) {
                    if (entry.urlKey && UrlParams.getParam(entry.urlKey)) {
                        this.props.setCurrentTask('PlotInfoTool');
                        this.queryInfoByEgrid(entry, UrlParams.getParam(entry.urlKey));
                        UrlParams.updateParams({[entry.urlKey]: undefined});
                        break;
                    }
                }
            }
        } else if (this.props.currentTask === 'PlotInfoTool' && prevProps.currentTask !== 'PlotInfoTool') {
            this.activated();
        } else if (this.props.currentTask !== 'PlotInfoTool' && prevProps.currentTask === 'PlotInfoTool') {
            this.deactivated();
        } else if (this.props.currentTask === 'PlotInfoTool' && this.props.selection.point &&
           this.props.selection !== prevProps.selection) {
            this.queryBasicInfoAtPoint(this.props.selection.point);
        }

        if (this.state.plotInfo) {
            if (
                this.state.plotInfo !== prevState.plotInfo ||
                this.state.currentPlot !== prevState.currentPlot
            ) {
                const layer = {
                    id: "plotselection",
                    role: LayerRole.SELECTION
                };
                const wkt = this.state.plotInfo[this.state.currentPlot].geom;
                const feature = VectorLayerUtils.wktToGeoJSON(wkt, "EPSG:2056", this.props.map.projection);
                feature.styleName = 'default';
                feature.styleOptions = {
                    fillColor: [0, 0, 0, 0],
                    strokeColor: [242, 151, 84, 0.75],
                    strokeWidth: 8,
                    strokeDash: []
                };
                this.props.addLayerFeatures(layer, [feature], true);
            }
        } else if (prevState.plotInfo && !this.state.plotInfo) {
            this.props.removeLayer("plotselection");
        }
    }
    render() {
        if (!this.state.plotInfo || this.state.plotInfo.length === 0) {
            return null;
        }
        let scrollable = false;
        if (this.state.expandedInfo) {
            const entry = this.props.infoQueries.find(e => e.key === this.state.expandedInfo);
            if (entry) {
                scrollable = entry.scrollmode === "parent";
            }
        }
        return (
            <ResizeableWindow icon="plot_info" initialHeight={this.props.windowSize.height}
                initialWidth={this.props.windowSize.width} initialX={0}
                initialY={0} onClose={() => this.props.setCurrentTask(null)}
                scrollable={scrollable} title="appmenu.items.PlotInfoTool"
            >
                {this.renderBody()}
            </ResizeableWindow>
        );
    }
    renderBody = () => {
        const plotServiceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '');
        const plot = this.state.plotInfo[this.state.currentPlot];
        return (
            <div className="plot-info-dialog-body" role="body">
                <div className="plot-info-dialog-header">
                    {this.state.plotInfo.map((entry, idx) => ([(
                        <div className="plot-info-result-header" key={"result-header-" + idx} onClick={() => this.toggleCurrentPlot(idx)}>
                            <Icon icon={this.state.currentPlot === idx ? "collapse" : "expand"} />
                            <span>{entry.label}</span>
                        </div>
                    ), this.state.currentPlot !== idx ? null : (
                        <div className="plot-info-result-body" key={"result-body-" + idx}>
                            <table><tbody>
                                {plot.fields.map(e => (
                                    <tr key={e.key}>
                                        <td dangerouslySetInnerHTML={{__html: e.key}} />
                                        <td><div dangerouslySetInnerHTML={{__html: e.value}} /></td>
                                    </tr>
                                ))}
                            </tbody></table>
                        </div>
                    )]))}
                </div>
                <div className="plot-info-dialog-queries">
                    {this.props.infoQueries.map((entry) => {
                        let query = entry.query.replace('$egrid$', plot.egrid);
                        if (!query.startsWith('http')) {
                            query = plotServiceUrl + query;
                        }
                        let pdfQuery = entry.pdfQuery ? entry.pdfQuery.replace('$egrid$', plot.egrid) : null;
                        if (pdfQuery && !pdfQuery.startsWith('http')) {
                            pdfQuery = plotServiceUrl + pdfQuery;
                        }
                        const pdfTooltip = entry.pdfTooltip ? LocaleUtils.tr(entry.pdfTooltip) : "";
                        const expanded = this.state.expandedInfo === entry.key;
                        return [
                            (
                                <div className="plot-info-dialog-query-title" key={entry.key + "-title"} onClick={() => this.toggleEgridInfo(entry, query)}>
                                    <Icon icon={expanded ? "collapse" : "expand"} />
                                    <span>{entry.titleMsgId ? LocaleUtils.tr(entry.titleMsgId) : entry.title}</span>
                                    {entry.pdfQuery ?
                                        this.state.pendingPdfs.includes(pdfQuery) ? (<Spinner />) :
                                            (<Icon icon="pdf" onClick={ev => this.queryPdf(ev, entry, pdfQuery)} title={pdfTooltip} />)
                                        : null}
                                </div>
                            ),
                            expanded ? (
                                <div className="plot-info-dialog-query-result" key={entry.key + "-result"}>
                                    {!this.state.expandedInfoData ? this.renderWait() : this.state.expandedInfoData.failed ? this.renderError() : this.renderInfoData()}
                                </div>
                            ) : null
                        ];
                    })}
                </div>
            </div>
        );
    };
    toggleCurrentPlot = (idx) => {
        if (this.state.currentPlot !== idx) {
            this.setState({currentPlot: idx, expandedInfo: null, expandedInfoData: null, pendingPdfs: []});
        }
    };
    renderWait = () => {
        return (
            <div className="plot-info-dialog-query-loading">
                <Spinner />
                <span>{LocaleUtils.tr("plotinfotool.loading")}</span>
            </div>
        );
    };
    renderError = () => {
        return (
            <div className="plot-info-dialog-query-failed">
                {this.state.expandedInfoData.failed === true ? LocaleUtils.tr("plotinfotool.failed") : LocaleUtils.tr(this.state.expandedInfoData.failed)}
            </div>
        );
    };
    renderInfoData = () => {
        if (this.props.customInfoComponents[this.state.expandedInfo]) {
            const Component = this.props.customInfoComponents[this.state.expandedInfo];
            const config = (this.props.infoQueries.find(entry => entry.key === this.state.expandedInfo) || {}).cfg || {};
            return (<Component config={config} data={this.state.expandedInfoData} />);
        } else {
            const assetsPath = ConfigUtils.getAssetsPath();
            const src = assetsPath + "/templates/blank.html";
            return (
                <iframe onLoad={ev => this.setIframeContent(ev.target, this.state.expandedInfoData)} src={src} />
            );
        }
    };
    setIframeContent = (iframe, html) => {
        if (!iframe.getAttribute("identify-content-set")) {
            iframe.setAttribute("identify-content-set", true);
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            doc.open();
            doc.write(html);
            doc.close();
        }
    };
    activated = () => {
        const assetsPath = ConfigUtils.getAssetsPath();
        this.props.changeSelectionState({geomType: 'Point', style: 'default', styleOptions: {
            fillColor: [0, 0, 0, 0],
            strokeColor: [0, 0, 0, 0]
        }, cursor: 'url("' + assetsPath + '/img/plot-info-marker.png") 12 12, default'});
        this.props.themeLayerRestorer(this.props.toolLayers, null, layers => {
            this.props.addThemeSublayer({sublayers: layers});
        });
    };
    deactivated = () => {
        this.setState({plotInfo: null, currentPlot: null, expandedInfo: null, expandedInfoData: null, pendingPdfs: []});
        this.props.changeSelectionState({geomType: null});
    };
    queryBasicInfoAtPoint = (point) => {
        this.props.clearSearch();
        const serviceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '') + '/';
        const params = {
            x: point[0],
            y: point[1]
        };
        axios.get(serviceUrl, {params}).then(response => {
            const plotInfo = !isEmpty(response.data.plots) ? response.data.plots : null;
            this.setState({plotInfo: plotInfo, currentPlot: 0, expandedInfo: null, expandedInfoData: null});
        }).catch(() => {});
    };
    queryInfoByEgrid = (query, egrid) => {
        const serviceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '');
        axios.get(serviceUrl + '/query/' + egrid).then(response => {
            const plotInfo = !isEmpty(response.data.plots) ? response.data.plots : null;
            this.setState({plotInfo: plotInfo, currentPlot: 0, expandedInfo: null, expandedInfoData: null});
            if (plotInfo) {
                const bounds = CoordinatesUtils.reprojectBbox(plotInfo[0].bbox, 'EPSG:2056', this.props.map.projection);
                const zoom = MapUtils.getZoomForExtent(bounds, this.props.map.resolutions, this.props.map.size, 0, this.props.map.scales.length - 1) - 1;
                this.props.zoomToPoint([0.5 * (bounds[0] + bounds[2]), 0.5 * (bounds[1] + bounds[3])], zoom, 'EPSG:2056');
                let url = query.query.replace('$egrid$', egrid);
                if (!url.startsWith('http')) {
                    url = serviceUrl + url;
                }
                this.toggleEgridInfo(query, url);
            }
        }).catch(e => {
            // eslint-disable-next-line
            alert("Query failed");
            // eslint-disable-next-line
            console.warn(e);
        });
    };
    queryPdf = (ev, infoEntry, queryUrl) => {
        this.props.logAction("PLOTINFO_PDF_QUERY", {info: infoEntry.key});
        ev.stopPropagation();
        this.setState((state) => ({pendingPdfs: [...state.pendingPdfs, queryUrl]}));
        axios.get(queryUrl, {responseType: 'blob', validateStatus: status => status >= 200 && status < 300 && status !== 204}).then(response => {
            const contentType = response.headers["content-type"];
            let filename = infoEntry.key + '.pdf';
            try {
                const contentDisposition = response.headers["content-disposition"];
                filename = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition)[1];
            } catch (e) {
                /* Pass */
            }
            FileSaver.saveAs(new Blob([response.data], {type: contentType}), filename);
            this.setState((state) => ({pendingPdfs: state.pendingPdfs.filter(entry => entry !== queryUrl)}));
        }).catch(() => {
            this.setState((state) => ({pendingPdfs: state.pendingPdfs.filter(entry => entry !== queryUrl)}));
            const errorMsg = infoEntry.failMsgId ? LocaleUtils.tr(infoEntry.failMsgId) : "";
            // eslint-disable-next-line
            alert(errorMsg || "Print failed");
        });
    };
    toggleEgridInfo = (infoEntry, queryUrl) => {
        if (this.state.expandedInfo === infoEntry.key) {
            this.setState({expandedInfo: null, expandedInfoData: null});
        } else {
            this.props.logAction("PLOTINFO_QUERY", {info: infoEntry.key});
            this.setState({expandedInfo: infoEntry.key, expandedInfoData: null});
            axios.get(queryUrl).then(response => {
                this.setState({expandedInfoData: response.data || {failed: infoEntry.failMsgId || true}});
            }).catch(() => {
                this.setState({expandedInfoData: {failed: infoEntry.failMsgId || true}});
            });
        }
    };
}

const selector = state => ({
    selection: state.selection,
    map: state.map,
    theme: state.theme.current,
    currentTask: state.task.id
});

export default connect(
    selector,
    {
        changeSelectionState: changeSelectionState,
        setCurrentTask: setCurrentTask,
        addThemeSublayer: addThemeSublayer,
        addLayerFeatures: addLayerFeatures,
        removeLayer: removeLayer,
        zoomToPoint: zoomToPoint,
        clearSearch: clearSearch,
        logAction: logAction
    }
)(PlotInfoTool);
