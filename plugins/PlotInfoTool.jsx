/**
 * Copyright 2019, Sourcepole AG.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

const React = require('react');
const PropTypes = require('prop-types');
const {connect} = require('react-redux');
const isEmpty = require('lodash.isempty');
const axios = require('axios');
const FileSaver = require('file-saver');
const {logAction} = require('qwc2/actions/logging');
const ConfigUtils = require('qwc2/utils/ConfigUtils');
const {changeSelectionState} = require('qwc2/actions/selection');
const {clearSearch} = require('qwc2/actions/search');
const {setCurrentTask} = require('qwc2/actions/task');
const {LayerRole, addThemeSublayer, addLayerFeatures, removeLayer} = require('qwc2/actions/layers');
const Message = require("qwc2/components/I18N/Message");
const ResizeableWindow = require('qwc2/components/ResizeableWindow');
const Spinner = require('qwc2/components/Spinner');
const Icon = require('qwc2/components/Icon');
const {zoomToPoint} = require('qwc2/actions/map');
const {UrlParams} = require("qwc2/utils/PermaLinkUtils");
const CoordinatesUtils = require('qwc2/utils/CoordinatesUtils');
const LocaleUtils = require('qwc2/utils/LocaleUtils');
const MapUtils = require('qwc2/utils/MapUtils');
const VectorLayerUtils = require('qwc2/utils/VectorLayerUtils');
require('./style/PlotInfoTool.css');


class PlotInfoTool extends React.Component {
    static propTypes = {
        theme: PropTypes.object,
        toolLayers: PropTypes.array,
        selection: PropTypes.object,
        map: PropTypes.object,
        windowSize: PropTypes.object,
        currentTask: PropTypes.string,
        changeSelectionState: PropTypes.func,
        setCurrentTask: PropTypes.func,
        addThemeSublayer: PropTypes.func,
        addLayerFeatures: PropTypes.func,
        removeLayer: PropTypes.func,
        zoomToPoint: PropTypes.func,
        clearSearch: PropTypes.func,
        themeLayerRestorer: PropTypes.func,
        infoQueries: PropTypes.array,
        customInfoComponents: PropTypes.object,
        logAction: PropTypes.func
    }
    static defaultProps = {
        toolLayers: [],
        infoQueries: [],
        customInfoComponents: {},
        windowSize: {width: 500, height: 800}
    }
    static contextTypes = {
        messages: PropTypes.object
    }
    state = {
        plotInfo: null,
        currentPlot: null,
        expandedInfo: null,
        expandedInfoData: null,
        pendingPdfs: []
    }
    componentWillReceiveProps(newProps) {
        if(newProps.theme && !this.props.theme) {
            if(UrlParams.getParam('realty') !== undefined) {
                this.props.setCurrentTask('PlotInfoTool');
            } else {
                for(let entry of newProps.infoQueries) {
                    if(entry.urlKey && UrlParams.getParam(entry.urlKey)) {
                        this.props.setCurrentTask('PlotInfoTool');
                        this.queryInfoByEgrid(entry, UrlParams.getParam(entry.urlKey));
                        UrlParams.updateParams({[entry.urlKey]: undefined});
                        break;
                    }
                }
            }
        } else if(newProps.currentTask === 'PlotInfoTool' && this.props.currentTask !== 'PlotInfoTool') {
            this.activated();
        } else if(newProps.currentTask !== 'PlotInfoTool' && this.props.currentTask === 'PlotInfoTool') {
            this.deactivated();
        } else if(newProps.currentTask === 'PlotInfoTool' && newProps.selection.point &&
           newProps.selection !== this.props.selection)
        {
            this.queryBasicInfoAtPoint(newProps.selection.point);
        }
    }
    componentDidUpdate(prevProps, prevState) {
        if(this.state.plotInfo) {
            if(
                this.state.plotInfo !== prevState.plotInfo ||
                this.state.currentPlot !== prevState.currentPlot
            ) {
                let layer = {
                    id: "plotselection",
                    role: LayerRole.SELECTION
                };
                let wkt = this.state.plotInfo[this.state.currentPlot].geom;
                let feature = VectorLayerUtils.wktToGeoJSON(wkt, "EPSG:2056", this.props.map.projection);
                feature.styleName = 'default';
                feature.styleOptions = {
                    fillColor: [0, 0, 0, 0],
                    strokeColor: [242, 151, 84, 0.75],
                    strokeWidth: 8,
                    strokeDash: []
                }
                this.props.addLayerFeatures(layer, [feature], true);
            }
        } else if(prevState.plotInfo && !this.state.plotInfo) {
            this.props.removeLayer("plotselection");
        }
    }
    render() {
        if(!this.state.plotInfo || this.state.plotInfo.length === 0) {
            return null;
        }
        let scrollable = false;
        if(this.state.expandedInfo) {
            let entry = this.props.infoQueries.find(entry => entry.key === this.state.expandedInfo);
            if(entry) {
                scrollable = entry.scrollmode === "parent";
            }
        }
        return (
            <ResizeableWindow title="appmenu.items.PlotInfoTool" icon="plot_info"
                onClose={() => this.props.setCurrentTask(null)} scrollable={scrollable}
                initialX={0} initialY={0}
                initialWidth={this.props.windowSize.width} initialHeight={this.props.windowSize.height}
            >
                {this.renderBody()}
            </ResizeableWindow>
        );
    }
    renderBody = () => {
        let plotServiceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '');
        let plot = this.state.plotInfo[this.state.currentPlot];
        return (
            <div role="body" className="plot-info-dialog-body">
                <div className="plot-info-dialog-header">
                    {this.state.plotInfo.map((entry, idx) => ([(
                        <div key={"result-header-" + idx} className="plot-info-result-header" onClick={ev => this.toggleCurrentPlot(idx)}>
                            <Icon icon={this.state.currentPlot === idx ? "collapse" : "expand"} />
                            <span>{entry.label}</span>
                        </div>
                    ), this.state.currentPlot !== idx ? null : (
                        <div className="plot-info-result-body" key={"result-body-" + idx}>
                            <table><tbody>
                                {plot.fields.map(entry => (
                                    <tr key={entry.key}>
                                        <td dangerouslySetInnerHTML={{__html: entry.key}}></td><td><div dangerouslySetInnerHTML={{__html: entry.value}}></div></td>
                                    </tr>
                                ))}
                            </tbody></table>
                    </div>
                )]))}
                </div>
                <div className="plot-info-dialog-queries">
                    {this.props.infoQueries.map((entry,idx) => {
                        let query = entry.query.replace('$egrid$', plot.egrid);
                        if(!query.startsWith('http')) {
                            query = plotServiceUrl + query;
                        }
                        let pdfQuery = entry.pdfQuery ? entry.pdfQuery.replace('$egrid$', plot.egrid) : null;
                        if(pdfQuery && !pdfQuery.startsWith('http')) {
                            pdfQuery = plotServiceUrl + pdfQuery;
                        }
                        let pdfTooltip = entry.pdfTooltip ? LocaleUtils.getMessageById(this.context.messages, entry.pdfTooltip) : "";
                        let expanded = this.state.expandedInfo === entry.key;
                        let customComponent = expanded ? this.props.customInfoComponents[this.state.expandedInfo] : false;
                        return [
                            (
                                <div key={entry.key + "-title"} className="plot-info-dialog-query-title" onClick={() => this.toggleEgridInfo(entry, query)}>
                                    <Icon icon={expanded ? "collapse" : "expand"} />
                                    <span>{entry.titleMsgId ? LocaleUtils.getMessageById(this.context.messages, entry.titleMsgId) : entry.title}</span>
                                    {entry.pdfQuery ?
                                        this.state.pendingPdfs.includes(pdfQuery) ? (<Spinner />) :
                                        (<Icon title={pdfTooltip} icon="pdf" onClick={ev => this.queryPdf(ev, entry, pdfQuery)} />)
                                     : null}
                                </div>
                            ),
                            expanded ? (
                                <div key={entry.key + "-result"} className="plot-info-dialog-query-result">
                                    {!this.state.expandedInfoData ? this.renderWait() : this.state.expandedInfoData.failed ? this.renderError() : this.renderInfoData()}
                                </div>
                            ) : null
                        ];
                    })}
                </div>
            </div>
        );
    }
    toggleCurrentPlot = (idx) => {
        if(this.state.currentPlot !== idx) {
            this.setState({currentPlot: idx, expandedInfo: null, expandedInfoData: null, pendingPdfs: []});
        }
    }
    renderWait = () => {
        return (
            <div className="plot-info-dialog-query-loading">
                <Spinner />
                <Message msgId="plotinfotool.loading" />
            </div>
        );
    }
    renderError = () => {
        return (
            <div className="plot-info-dialog-query-failed">
                <Message msgId={this.state.expandedInfoData.failed === true ? "plotinfotool.failed" : this.state.expandedInfoData.failed} />
            </div>
        );
    }
    renderInfoData = () => {
        if(this.props.customInfoComponents[this.state.expandedInfo]) {
            let Component = this.props.customInfoComponents[this.state.expandedInfo];
            let config = (this.props.infoQueries.find(entry => entry.key === this.state.expandedInfo) || {}).cfg || {};
            return (<Component data={this.state.expandedInfoData} config={config} />);
        } else {
            let assetsPath = ConfigUtils.getConfigProp("assetsPath");
            let src = assetsPath + "/templates/blank.html";
            return (
                <iframe src={src} onLoad={ev => this.setIframeContent(ev.target, this.state.expandedInfoData)}></iframe>
            );
        }
        return null;
    }
    setIframeContent = (iframe, html) => {
        if(!iframe.getAttribute("identify-content-set")) {
            iframe.setAttribute("identify-content-set", true);
            let doc = iframe.contentDocument || iframe.contentWindow.document;
            doc.open();
            doc.write(html);
            doc.close();
        }
    }
    activated = () => {
        let assetsPath = ConfigUtils.getConfigProp("assetsPath");
        this.props.changeSelectionState({geomType: 'Point', style: 'default', styleOptions: {
            fillColor: [0, 0, 0, 0],
            strokeColor: [0, 0, 0, 0]
        }, cursor: 'url("' + assetsPath + '/img/plot-info-marker.png") 12 12, default'});
        this.props.themeLayerRestorer(this.props.toolLayers, null, layers => {
            this.props.addThemeSublayer({sublayers: layers});
        });
    }
    deactivated = () => {
        this.setState({plotInfo: null, currentPlot: null, expandedInfo: null, expandedInfoData: null, pendingPdfs: []});
        this.props.changeSelectionState({geomType: null});
    }
    queryBasicInfoAtPoint = (point) => {
        this.props.clearSearch();
        let serviceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '') + '/';
        let params = {
            x: point[0],
            y: point[1]
        };
        axios.get(serviceUrl, {params}).then(response => {
            let plotInfo = !isEmpty(response.data.plots) ? response.data.plots : null
            this.setState({plotInfo: plotInfo, currentPlot: 0, expandedInfo: null, expandedInfoData: null});
        }).catch(e => {});
    }
    queryInfoByEgrid = (query, egrid) => {
        const serviceUrl = ConfigUtils.getConfigProp("plotInfoService").replace(/\/$/, '');
        axios.get(serviceUrl + '/query/' + egrid).then(response => {
            let plotInfo = !isEmpty(response.data.plots) ? response.data.plots : null
            this.setState({plotInfo: plotInfo, currentPlot: 0, expandedInfo: null, expandedInfoData: null});
            if(plotInfo) {
                let bounds = CoordinatesUtils.reprojectBbox(plotInfo[0].bbox, 'EPSG:2056', this.props.map.projection);
                let zoom = MapUtils.getZoomForExtent(bounds, this.props.map.resolutions, this.props.map.size, 0, this.props.map.scales.length - 1) - 1;
                this.props.zoomToPoint([0.5 * (bounds[0] + bounds[2]), 0.5 * (bounds[1] + bounds[3])], zoom, 'EPSG:2056');
                let url = serviceUrl + query.query.replace('$egrid$', egrid);
                this.toggleEgridInfo(query, url);
            }
        }).catch(e => {
            alert("Query failed");
            console.warn(e);
        });
    }
    queryPdf = (ev, infoEntry, queryUrl) => {
        this.props.logAction("PLOTINFO_PDF_QUERY", {info: infoEntry.key});
        ev.stopPropagation();
        this.setState({pendingPdfs: [...this.state.pendingPdfs, queryUrl]});
        axios.get(queryUrl, {responseType: 'blob', validateStatus: status => status >= 200 && status < 300 && status != 204}).then(response => {
            let contentType = response.headers["content-type"];
            let filename = infoEntry.key + '.pdf';
            try {
                let contentDisposition = response.headers["content-disposition"];
                filename = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition)[1];
            } catch(e) {
            }
            FileSaver.saveAs(new Blob([response.data], {type: contentType}), filename);
            this.setState({pendingPdfs: this.state.pendingPdfs.filter(entry => entry !== queryUrl)});
        }).catch(e => {
            this.setState({pendingPdfs: this.state.pendingPdfs.filter(entry => entry !== queryUrl)});
            let errorMsg = infoEntry.failMsgId ? LocaleUtils.getMessageById(this.context.messages, infoEntry.failMsgId) : "";
            alert(errorMsg || "Print failed");
        });
    }
    toggleEgridInfo = (infoEntry, queryUrl) => {
        if(this.state.expandedInfo === infoEntry.key) {
            this.setState({expandedInfo: null, expandedInfoData: null});
        } else {
            this.props.logAction("PLOTINFO_QUERY", {info: infoEntry.key});
            this.setState({expandedInfo: infoEntry.key, expandedInfoData: null});
            axios.get(queryUrl).then(response => {
                this.setState({expandedInfoData: response.data || {"failed": infoEntry.failMsgId || true}});
            }).catch(e => {
                this.setState({expandedInfoData: {"failed": infoEntry.failMsgId || true}});
            });
        }
    }
};

const selector = state => ({
    selection: state.selection,
    map: state.map,
    theme: state.theme.current,
    currentTask: state.task.id
});

module.exports = {
    PlotInfoToolPlugin: connect(
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
    )(PlotInfoTool),
    reducers: {
        selection: require('qwc2/reducers/selection')
    }
};
