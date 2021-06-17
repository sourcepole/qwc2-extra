/**
 * Copyright 2017-2021 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

 import axios from 'axios';
 import React from 'react';
 import PropTypes from 'prop-types';
 import {connect} from 'react-redux';
 import isEmpty from 'lodash.isempty';
 import {stringify} from 'wellknown';
 import {LayerRole, addMarker, removeMarker, removeLayer} from 'qwc2/actions/layers';
 import {changeSelectionState} from 'qwc2/actions/selection';
 import IdentifyViewer from 'qwc2/components/IdentifyViewer';
 import ResizeableWindow from 'qwc2/components/ResizeableWindow';
 import TaskBar from 'qwc2/components/TaskBar';
 import IdentifyUtils from 'qwc2/utils/IdentifyUtils';
 import LocaleUtils from 'qwc2/utils/LocaleUtils';
 
 class PlotInfoTool extends React.Component {
     static propTypes = {
         addMarker: PropTypes.func,
         attributeCalculator: PropTypes.func,
         attributeTransform: PropTypes.func,
         changeSelectionState: PropTypes.func,
         click: PropTypes.object,
         currentIdentifyTool: PropTypes.string,
         currentTask: PropTypes.string,
         displayResultTree: PropTypes.bool,
         enableExport: PropTypes.bool,
         featureInfoReturnsLayerName: PropTypes.bool,
         iframeDialogsInitiallyDocked: PropTypes.bool,
         initialHeight: PropTypes.number,
         initialWidth: PropTypes.number,
         initiallyDocked: PropTypes.bool,
         layers: PropTypes.array,
         longAttributesDisplay: PropTypes.string,
         map: PropTypes.object,
         params: PropTypes.object,
         removeLayer: PropTypes.func,
         removeMarker: PropTypes.func,
         selection: PropTypes.object
     }
     static defaultProps = {
         enableExport: true,
         longAttributesDisplay: 'ellipsis',
         displayResultTree: true,
         initialWidth: 240,
         initialHeight: 320,
         featureInfoReturnsLayerName: true
     }
     state = {
         mode: 'Point',
         identifyResults: null,
         pendingRequests: 0
     }
     componentDidUpdate(prevProps, prevState) {
         if (this.props.currentIdentifyTool !== prevProps.currentIdentifyTool && prevProps.currentIdentifyTool === "Identify") {
             this.clearResults();
         }
         if ((this.props.currentTask === "Identify" && this.state.mode === "Point") || this.props.currentIdentifyTool === "Identify") {
             this.identifyPoint(prevProps);
         } else if (this.props.currentTask === "Identify" && this.state.mode === "Region") {
             this.identifyRegion(prevProps);
         }
     }
     identifyPoint = (prevProps) => {
         const clickPoint = this.queryPoint(prevProps);
         if (clickPoint) {
             // Remove any search selection layer to avoid confusion
             this.props.removeLayer("searchselection");
             let pendingRequests = 0;
             const identifyResults = this.props.click.modifiers.ctrl !== true ? {} : this.state.identifyResults;
 
             let queryableLayers = [];
             queryableLayers = IdentifyUtils.getQueryLayers(this.props.layers, this.props.map);
             queryableLayers.forEach(l => {
                 const request = IdentifyUtils.buildRequest(l, l.queryLayers.join(","), clickPoint, this.props.map, this.props.params);
                 ++pendingRequests;
                 axios.get(request.url, {params: request.params}).then((response) => {
                     this.setState({pendingRequests: this.state.pendingRequests - 1});
                     this.parseResult(response.data, l, request.params.info_format, clickPoint);
                 }).catch((e) => {
                     console.log(e);
                     this.setState({pendingRequests: this.state.pendingRequests - 1});
                 });
             });
 
             let queryFeature = null;
             if (this.props.click.feature) {
                 const layer = this.props.layers.find(l => l.id === this.props.click.layer);
                 if (layer && layer.role === LayerRole.USERLAYER && layer.type === "vector" && !isEmpty(layer.features)) {
                     queryFeature = layer.features.find(feature =>  feature.id === this.props.click.feature);
                     if (queryFeature && !isEmpty(queryFeature.properties)) {
                         identifyResults[layer.name] = [queryFeature];
                     }
                 }
             }
             this.props.addMarker('identify', clickPoint, '', this.props.map.projection);
             this.setState({identifyResults: identifyResults, pendingRequests: pendingRequests});
         }
     }
     queryPoint = (prevProps) => {
         if (this.props.click.button !== 0 || this.props.click === prevProps.click || this.props.click.feature === "startupposmarker") {
             return null;
         }
         if (this.props.click.feature === 'searchmarker' && this.props.click.geometry && this.props.click.geomType === 'Point') {
             return this.props.click.geometry;
         }
         return this.props.click.coordinate;
     }
     identifyRegion = (prevProps) => {
         if (!this.props.selection.polygon || this.props.selection === prevProps.selection) {
             return;
         }
         const poly = this.props.selection.polygon;
         const queryableLayers = IdentifyUtils.getQueryLayers(this.props.layers, this.props.map);
         if (poly.length < 1 || isEmpty(queryableLayers)) {
             return;
         }
         const identifyResults = this.props.click.modifiers.ctrl !== true ? {} : this.state.identifyResults;
         this.props.changeSelectionState({reset: true});
         const geometry = {
             type: "Polygon",
             coordinates: [poly]
         };
         const center = [0, 0];
         poly.forEach(point => {
             center[0] += point[0];
             center[1] += point[1];
         });
         center[0] /= poly.length;
         center[1] /= poly.length;
 
         const filter = stringify(geometry);
         let pendingRequests = 0;
         const params = {...this.props.params};
         if (this.props.params.region_feature_count) {
             params.feature_count = this.props.params.region_feature_count;
             delete params.region_feature_count;
         }
         queryableLayers.forEach(layer => {
             const request = IdentifyUtils.buildFilterRequest(layer, layer.queryLayers.join(","), filter, this.props.map, this.props.params);
             ++pendingRequests;
             axios.get(request.url, {params: request.params}).then((response) => {
                 this.setState({pendingRequests: this.state.pendingRequests - 1});
                 this.parseResult(response.data, layer, request.params.info_format, center);
             }).catch((e) => {
                 console.log(e);
                 this.setState({pendingRequests: this.state.pendingRequests - 1});
             });
             this.setState({identifyResults: identifyResults, pendingRequests: pendingRequests});
         });
     }
     parseResult = (response, layer, format, clickPoint) => {
         const newResults = IdentifyUtils.parseResponse(response, layer, format, clickPoint, this.props.map.projection, this.props.featureInfoReturnsLayerName, this.props.layers);
         // Merge with previous
         const identifyResults = {...this.state.identifyResults};
         Object.keys(newResults).map(layername => {
             const newFeatureIds = newResults[layername].map(feature => feature.id);
             identifyResults[layername] = [
                 ...(identifyResults[layername] || []).filter(feature => !newFeatureIds.includes(feature.id)),
                 ...newResults[layername]
             ];
         });
         this.setState({identifyResults: identifyResults});
     }
     onShow = (mode) => {
         this.setState({mode: mode || 'Point'});
         if (mode === "Region") {
             this.props.changeSelectionState({geomType: 'Polygon'});
         }
     }
     onToolClose = () => {
         this.props.removeMarker('identify');
         this.props.removeLayer("identifyslection");
         this.props.changeSelectionState({geomType: undefined});
         this.setState({identifyResults: null, pendingRequests: 0, mode: 'Point'});
     }
     clearResults = () => {
         this.props.removeMarker('identify');
         this.props.removeLayer("identifyslection");
         this.setState({identifyResults: null, pendingRequests: 0});
     }
     render() {
         let resultWindow = null;
         if (this.state.pendingRequests > 0 || this.state.identifyResults !== null) {
             let body = null;
             if (isEmpty(this.state.identifyResults)) {
                 if (this.state.pendingRequests > 0) {
                     body = (<div className="identify-body" role="body"><span className="identify-body-message">{LocaleUtils.tr("identify.querying")}</span></div>);
                 } else {
                     body = (<div className="identify-body" role="body"><span className="identify-body-message">{LocaleUtils.tr("identify.noresults")}</span></div>);
                 }
             } else {
                 body = (
                     <IdentifyViewer
                         attributeCalculator={this.props.attributeCalculator}
                         attributeTransform={this.props.attributeTransform}
                         displayResultTree={this.props.displayResultTree}
                         enableExport={this.props.enableExport}
                         identifyResults={this.state.identifyResults}
                         iframeDialogsInitiallyDocked={this.props.iframeDialogsInitiallyDocked}
                         longAttributesDisplay={this.props.longAttributesDisplay}
                         role="body" />
                 );
             }
             resultWindow = (
                 <ResizeableWindow icon="info-sign"
                     initialHeight={this.props.initialHeight} initialWidth={this.props.initialWidth}
                     initialX={0} initialY={0} initiallyDocked={this.props.initiallyDocked}
                     key="IdentifyWindow"
                     onClose={this.clearResults} title={LocaleUtils.trmsg("identify.title")} zIndex={8}
                 >
                     {body}
                 </ResizeableWindow>
             );
         }
         return [resultWindow, (
             <TaskBar key="IdentifyTaskBar" onHide={this.onToolClose} onShow={this.onShow} task="Identify">
                 {() => ({
                     body: this.state.mode === "Region" ? LocaleUtils.tr("infotool.clickhelpPolygon") : LocaleUtils.tr("infotool.clickhelpPoint")
                 })}
             </TaskBar>
         )];
     }
 }
 
 const selector = (state) => ({
     click: state.map.click || {},
     currentTask: state.task.id,
     currentIdentifyTool: state.identify.tool,
     layers: state.layers.flat,
     map: state.map,
     selection: state.selection
 });
 
 export default connect(selector, {
     addMarker: addMarker,
     changeSelectionState: changeSelectionState,
     removeMarker: removeMarker,
     removeLayer: removeLayer
 })(PlotInfoTool);
