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
import url from 'url';
import xml2js from 'xml2js';
import {LayerRole, addLayer, removeLayer, changeLayerProperty} from 'qwc2/actions/layers';
import Icon from 'qwc2/components/Icon';
import LocaleUtils from 'qwc2/utils/LocaleUtils';
require('./style/OerebDocument.css');

const Lang = "de";

class Oereb2Document extends React.Component {
    static propTypes = {
        addLayer: PropTypes.func,
        changeLayerProperty: PropTypes.func,
        config: PropTypes.object,
        data: PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.object
        ]),
        layers: PropTypes.array,
        removeLayer: PropTypes.func
    }
    state = {
        oerebDoc: null,
        expandedSection: null,
        expandedTheme: null,
        expandedLegend: null
    }
    constructor(props) {
        super(props);
        this.state.oerebDoc = this.getOerebDoc(props.data);
    }
    componentDidUpdate(prevProps) {
        if (prevProps.data !== this.props.data) {
            this.setState({oerebDoc: this.getOerebDoc(this.props.data)});
        }
    }
    componentWillUnmount() {
        this.removeHighlighLayer();
    }
    getOerebDoc(oerebDoc) {
        if (typeof oerebDoc === "object") {
            return oerebDoc;
        } else {
            let json;
            const options = {
                tagNameProcessors: [xml2js.processors.stripPrefix],
                valueProcessors: [(text) => decodeURIComponent(text)],
                explicitArray: false
            };
            xml2js.parseString(oerebDoc, options, (err, result) => {
                json = result;
            });
            // Case sensitivity difference between XML and JSON
            json.GetExtractByIdResponse.extract = json.GetExtractByIdResponse.Extract;
            return json;
        }
    }
    render() {
        const extract = this.state.oerebDoc.GetExtractByIdResponse.extract;
        return (
            <div className="oereb-document">
                {this.renderSection("concernedThemes", LocaleUtils.trmsg("oereb.concernedThemes"), this.renderConcernedThemes, this.ensureArray(extract.ConcernedTheme))}
                {this.renderSection("notConcernedThemes", LocaleUtils.trmsg("oereb.notConcernedThemes"), this.renderOtherThemes, this.ensureArray(extract.NotConcernedTheme))}
                {this.renderSection("themeWithoutData", LocaleUtils.trmsg("oereb.themeWithoutData"), this.renderOtherThemes, this.ensureArray(extract.ThemeWithoutData))}
                {this.renderSection("generalInformation", LocaleUtils.trmsg("oereb.generalInformation"), this.renderGeneralInformation, extract)}
            </div>
        );
    }
    renderSection = (name, titlemsgid, renderer, data) => {
        if (isEmpty(data)) {
            return null;
        }
        const icon = this.state.expandedSection === name ? 'chevron-up' : 'chevron-down';
        return (
            <div className="oereb-document-section">
                <div className="oereb-document-section-title" onClick={() => this.toggleSection(name)}>
                    <span>{LocaleUtils.tr(titlemsgid)}</span>
                    <span>{data.length}&nbsp;<Icon icon={icon} /></span>
                </div>
                {this.state.expandedSection === name ? renderer(data) : null}
            </div>
        );
    }
    renderConcernedThemes = (themes) => {
        return (
            <div className="oereb-document-section-concerned-themes">
                {themes.map(theme => {
                    const themeId = theme.Code + ":" + theme.SubCode;
                    const icon = this.state.expandedTheme === themeId ? 'chevron-up' : 'chevron-down';

                    const extract = this.state.oerebDoc.GetExtractByIdResponse.extract;
                    const landOwnRestr = this.ensureArray(extract.RealEstate.RestrictionOnLandownership);
                    const entry = landOwnRestr.find(entry => entry.Theme.Code === theme.Code && entry.Theme.SubCode === theme.SubCode);
                    return (
                        <div className="oereb-document-theme" key={themeId}>
                            <div className="oereb-document-theme-title" onClick={() => this.toggleTheme(theme.Code, theme.SubCode)}>
                                <span>{this.localizedText(theme.Text)} ({this.localizedText(entry.Lawstatus.Text)})</span>
                                <Icon icon={icon} />
                            </div>
                            {this.state.expandedTheme === themeId ? this.renderTheme(theme.Code, theme.SubCode) : null}
                        </div>
                    );
                })}
            </div>
        );
    }
    collectConcernedThemes = (landOwnRestr, code, subcode) => {
        let subthemes = [""];
        let entries = landOwnRestr.filter(entry => entry.Theme.Code === code && entry.Theme.SubCode === subcode);
        let isSubTheme = false;
        if (!isEmpty(entries)) {
            // Main theme match, order subthemes according to config
            subthemes = (this.props.config.subthemes || {})[name] || [""];
            entries = entries.sort((x, y) => subthemes.indexOf(x.SubTheme) - subthemes.indexOf(y.SubTheme));
        } else {
            // Attempt to match by subtheme name
            entries = landOwnRestr.filter(entry => entry.SubTheme === name);
            if (!isEmpty(entries)) {
                subthemes = [name];
                isSubTheme = true;
            }
        }
        return {entries, subthemes, isSubTheme};
    }
    renderTheme = (code, subcode) => {
        const extract = this.state.oerebDoc.GetExtractByIdResponse.extract;
        const landOwnRestr = this.ensureArray(extract.RealEstate.RestrictionOnLandownership);
        const {entries, subthemes, isSubTheme} = this.collectConcernedThemes(landOwnRestr, code, subcode);
        const regulations = {};
        const legalbasis = {};
        const hints = {};
        let respoffices = {};
        for (const entry of entries) {
            for (const prov of this.ensureArray(entry.LegalProvisions)) {
                if (prov.Type.Code === "LegalProvision") {
                    regulations[this.localizedText(prov.TextAtWeb)] = {
                        label: this.localizedText(prov.Title) + (prov.OfficialNumber ? ", " + this.localizedText(prov.OfficialNumber) : ""),
                        link: this.localizedText(prov.TextAtWeb),
                        index: prov.Index
                    };
                } else if (prov.Type.Code === "Law") {
                    legalbasis[this.localizedText(prov.TextAtWeb)] = {
                        label: this.localizedText(prov.Title) + (prov.Abbreviation ? " (" + this.localizedText(prov.Abbreviation) + ")" : "") + (prov.OfficialNumber ? ", " + this.localizedText(prov.OfficialNumber) : ""),
                        link: this.localizedText(prov.TextAtWeb),
                        index: prov.Index
                    };
                } else if (prov.Type.Code === "Hint") {
                    hints[this.localizedText(prov.TextAtWeb)] = {
                        label: this.localizedText(prov.Title),
                        link: this.localizedText(prov.TextAtWeb),
                        index: prov.Index
                    };
                }
                respoffices[this.localizedText(prov.ResponsibleOffice.OfficeAtWeb)] = {
                    label: this.localizedText(prov.ResponsibleOffice.Name),
                    link: this.localizedText(prov.ResponsibleOffice.OfficeAtWeb)
                };
            }
        }
        if ((this.props.config || {}).responsibleOfficeFromRestriction) {
            respoffices = entries.reduce((res, restr) => {
                res[this.localizedText(restr.ResponsibleOffice.OfficeAtWeb)] = {
                    label: this.localizedText(restr.ResponsibleOffice.Name),
                    link: this.localizedText(restr.ResponsibleOffice.OfficeAtWeb)
                };
                return res;
            }, {});
        }

        const legendSymbols = {};
        for (const entry of entries) {
            const subTheme = entry.SubTheme || "";
            if (!(subTheme in legendSymbols)) {
                legendSymbols[subTheme] = {
                    symbols: {},
                    fullLegend: (entry.Map || {}).LegendAtWeb
                };
            }
            const subThemeSymbols = legendSymbols[subTheme].symbols;
            if (entry.SymbolRef in subThemeSymbols) {
                if (subThemeSymbols[entry.SymbolRef].NrOfPoints && entry.NrOfPoints) {
                    subThemeSymbols[entry.SymbolRef].NrOfPoints += this.ensureNumber(entry.NrOfPoints);
                } else if (entry.NrOfPoints) {
                    subThemeSymbols[entry.SymbolRef].NrOfPoints = this.ensureNumber(entry.NrOfPoints);
                }
                if (subThemeSymbols[entry.SymbolRef].AreaShare && entry.AreaShare) {
                    subThemeSymbols[entry.SymbolRef].AreaShare += this.ensureNumber(entry.AreaShare);
                } else if (entry.AreaShare) {
                    subThemeSymbols[entry.SymbolRef].AreaShare = this.ensureNumber(entry.AreaShare);
                }
                if (subThemeSymbols[entry.SymbolRef].LengthShare && entry.LengthShare) {
                    subThemeSymbols[entry.SymbolRef].LengthShare += this.ensureNumber(entry.LengthShare);
                } else if (entry.LengthShare) {
                    subThemeSymbols[entry.SymbolRef].LengthShare = this.ensureNumber(entry.LengthShare);
                }
                if (subThemeSymbols[entry.SymbolRef].PartInPercent && entry.PartInPercent) {
                    subThemeSymbols[entry.SymbolRef].PartInPercent += this.ensureNumber(entry.PartInPercent);
                } else if (entry.PartInPercent) {
                    subThemeSymbols[entry.SymbolRef].PartInPercent = this.ensureNumber(entry.PartInPercent);
                }
            } else {
                subThemeSymbols[entry.SymbolRef] = {
                    LegendText: entry.LegendText,
                    NrOfPoints: this.ensureNumber(entry.NrOfPoints),
                    AreaShare: this.ensureNumber(entry.AreaShare),
                    LengthShare: this.ensureNumber(entry.LengthShare),
                    PartInPercent: this.ensureNumber(entry.PartInPercent)
                };
            }
        }
        return (
            <div className="oereb-document-theme-contents">
                {subthemes.slice(0).reverse().map((subtheme, idx) => {
                    const subthemedata = legendSymbols[subtheme];
                    if (!subthemedata) {
                        return (
                            <div className="oereb-document-subtheme-container" key={"subtheme" + idx}>
                                <div className="oereb-document-subtheme-emptytitle">{subtheme}</div>
                            </div>
                        );
                    }
                    const fullLegendId = this.state.expandedTheme + "_" + (subtheme || "");
                    const toggleLegendMsgId = this.state.expandedLegend === fullLegendId ? LocaleUtils.trmsg("oereb.hidefulllegend") : LocaleUtils.trmsg("oereb.showfulllegend");
                    const subThemeLayer = this.props.layers.find(layer => layer.__oereb_subtheme === subtheme);
                    return (
                        <div className="oereb-document-subtheme-container" key={"subtheme" + idx}>
                            {subtheme && !isSubTheme ? (<div className="oereb-document-subtheme-title">
                                {subThemeLayer ? (<Icon icon={subThemeLayer.visibility === true ? 'checked' : 'unchecked'} onClick={() => this.toggleThemeLayer(subThemeLayer)}/>) : null}
                                {subtheme}
                            </div>) : null}
                            <table><tbody>
                                <tr>
                                    <th>{LocaleUtils.tr("oereb.type")}</th>
                                    <th />
                                    <th>{LocaleUtils.tr("oereb.share")}</th>
                                    <th>{LocaleUtils.tr("oereb.perc")}</th>
                                </tr>
                                {Object.entries(subthemedata.symbols).map(([symbol, data], jdx) => {
                                    return [data.NrOfPoints ? (
                                        <tr key={"sympts" + jdx}>
                                            <td>{this.localizedText(data.LegendText)}</td>
                                            <td><img src={symbol} /></td>
                                            <td>{data.NrOfPoints}&nbsp;{LocaleUtils.tr("oereb.nrpoints")}</td>
                                            <td>-</td>
                                        </tr>
                                    ) : null,
                                    data.LengthShare ? (
                                        <tr key={"symlen" + jdx}>
                                            <td>{this.localizedText(data.LegendText)}</td>
                                            <td><img src={symbol} /></td>
                                            <td>{data.LengthShare}&nbsp;m</td>
                                            {data.PartInPercent ? (<td>{data.PartInPercent.toFixed(1) + "%"}</td>) : (<td>-</td>)}
                                        </tr>
                                    ) : null,
                                    data.AreaShare ? (
                                        <tr key={"symarea" + jdx}>
                                            <td>{this.localizedText(data.LegendText)}</td>
                                            <td><img src={symbol} /></td>
                                            <td>{data.AreaShare}&nbsp;m<sup>2</sup></td>
                                            {data.PartInPercent ? (<td>{data.PartInPercent.toFixed(1) + "%"}</td>) : (<td>-</td>)}
                                        </tr>
                                    ) : null];
                                })}
                            </tbody></table>
                            {subthemedata.fullLegend ? (
                                <div>
                                    <div className="oereb-document-toggle-fulllegend" onClick={() => this.toggleFullLegend(fullLegendId)}>
                                        <a>{LocaleUtils.tr(toggleLegendMsgId)}</a>
                                    </div>
                                    {this.state.expandedLegend === fullLegendId ? (<div className="oereb-document-fulllegend"><img src={subthemedata.fullLegend} /></div>) : null}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
                {this.renderDocuments(regulations, LocaleUtils.trmsg("oereb.regulations"))}
                {this.renderDocuments(legalbasis, LocaleUtils.trmsg("oereb.legalbasis"))}
                {this.renderDocuments(hints, LocaleUtils.trmsg("oereb.hints"))}
                {this.renderDocuments(respoffices, LocaleUtils.trmsg("oereb.responsibleoffice"))}
            </div>
        );
    }
    renderDocuments = (documents, sectiontitle) => {
        return isEmpty(documents) ? null : (
            <div>
                <h1>{LocaleUtils.tr(sectiontitle)}</h1>
                <ul>
                    {Object.values(documents).sort((a, b) => a.index !== b.index ? a.index - b.index : a.label.localeCompare(b.label)).map((doc, idx) => (
                        <li key={"doc" + idx}><a href={doc.link} rel="noopener noreferrer" target="_blank" title={doc.label}>&#128279; {doc.label}</a></li>
                    ))}
                </ul>
            </div>
        );
    }
    renderOtherThemes = (themes) => {
        return (
            <div className="oereb-document-section-other-themes">
                {themes.map(theme => (<div key={theme.Code + ":" + theme.SubCode}>{this.localizedText(theme.Text)}</div>))}
            </div>
        );
    }
    renderGeneralInformation = (extract) => {
        return (
            <div className="oereb-document-section-general-info">
                <h1>{LocaleUtils.tr("oereb.responsibleauthority")}</h1>
                <table><tbody>
                    <tr>
                        {(this.props.config || {}).hideLogo ? null : (<td rowSpan="4" style={{verticalAlign: 'top'}}><img src={extract.CantonalLogoRef} /></td>)}
                        <td><b>{this.localizedText(extract.PLRCadastreAuthority.Name)}</b></td>
                    </tr>
                    <tr>
                        <td>{extract.PLRCadastreAuthority.Street} {extract.PLRCadastreAuthority.Number}</td>
                    </tr>
                    <tr>
                        <td>{extract.PLRCadastreAuthority.PostalCode} {extract.PLRCadastreAuthority.City}</td>
                    </tr>
                    <tr>
                        <td>
                            <a href={this.localizedText(extract.PLRCadastreAuthority.OfficeAtWeb)} rel="noopener noreferrer" target="_blank">
                                {this.localizedText(extract.PLRCadastreAuthority.OfficeAtWeb)}
                            </a>
                        </td>
                    </tr>
                </tbody></table>
                <h1>{LocaleUtils.tr("oereb.fundations")}</h1>
                <p>{LocaleUtils.tr("oereb.fundationdatastate")} {new Date(extract.UpdateDateCS).toLocaleDateString()}</p>
                <h1>{LocaleUtils.tr("oereb.generalinfo")}</h1>
                <p>{this.localizedText(extract.GeneralInformation)}</p>
                {this.ensureArray(extract.ExclusionOfLiability).map((entry, idx) => [
                    (<h1 key={"exclt" + idx}>{this.localizedText(entry.Title)}</h1>),
                    (<p key={"exclc" + idx}>{this.localizedText(entry.Content)}</p>)
                ])}
                {this.ensureArray(extract.Disclaimer).map((entry, idx) => [
                    (<h1 key={"disclt" + idx}>{this.localizedText(entry.Title)}</h1>),
                    (<p key={"disclc" + idx}>{this.localizedText(entry.Content)}</p>)
                ])}
            </div>
        );
    }
    toggleSection = (name) => {
        this.setState({
            expandedSection: this.state.expandedSection === name ? null : name,
            expandedTheme: null,
            expandedLegend: null
        });
        this.removeHighlighLayer();
    }
    removeHighlighLayer = () => {
        // Remove previous __oereb_highlight layers
        const layers = this.props.layers.filter(layer => layer.__oereb_highlight === true);
        for (const layer of layers) {
            this.props.removeLayer(layer.id);
        }
    }
    toggleTheme = (code, subcode) => {
        const themeId = code + ":" + subcode;
        const expandedTheme = this.state.expandedTheme === themeId ? null : themeId;
        this.setState({
            expandedTheme: expandedTheme,
            expandedLegend: null
        });
        this.removeHighlighLayer();
        if (!expandedTheme) {
            return;
        }

        const extract = this.state.oerebDoc.GetExtractByIdResponse.extract;
        const landOwnRestr = this.ensureArray(extract.RealEstate.RestrictionOnLandownership);

        const entries = this.collectConcernedThemes(landOwnRestr, code, subcode).entries;
        const subThemeLayers = new Set();
        for (const entry of entries) {
            if (!entry.Map || !entry.Map.ReferenceWMS || subThemeLayers.has(entry.SubTheme)) {
                continue;
            }
            const parts = url.parse(this.localizedText(entry.Map.ReferenceWMS), true);
            const baseUrl = parts.protocol + '//' + parts.host + parts.pathname;
            const params = parts.query;
            const layer = {
                id: themeId + Date.now().toString(),
                role: LayerRole.USERLAYER,
                type: "wms",
                name: themeId,
                title: this.localizedText(entry.Theme.Text),
                legendUrl: baseUrl,
                url: baseUrl,
                version: params.VERSION,
                featureInfoUrl: baseUrl,
                queryable: false,
                bbox: params.BBOX,
                visibility: true,
                opacity: entry.Map.layerOpacity !== undefined ? this.ensureNumber(entry.Map.layerOpacity) * 255 : 255,
                format: params.FORMAT,
                params: {LAYERS: params.LAYERS},
                __oereb_highlight: true,
                __oereb_subtheme: entry.SubTheme
            };
            this.props.addLayer(layer);
            subThemeLayers.add(entry.SubTheme);
        }
    }
    toggleFullLegend = (legendId) => {
        const expandedLegend = this.state.expandedLegend === legendId ? null : legendId;
        this.setState({expandedLegend});
    }
    toggleThemeLayer = (subthemelayer) => {
        this.props.changeLayerProperty(subthemelayer.uuid, "visibility", !subthemelayer.visibility);
    }
    localizedText = (el) => {
        if (isEmpty(el)) {
            return "";
        }
        if (el.LocalisedText) {
            el = el.LocalisedText;
        }
        if (Array.isArray(el)) {
            const entry = el.find(e => e.Language === Lang);
            return entry ? entry.Text : el[0].Text;
        } else {
            return el.Text;
        }
    }
    ensureArray = (el) => {
        if (el === undefined) {
            return [];
        }
        return Array.isArray(el) ? el : [el];
    }
    ensureNumber = (value) => {
        return parseFloat(value) || 0;
    }
}

export default connect(state => ({
    layers: state.layers.flat
}), {
    addLayer: addLayer,
    removeLayer: removeLayer,
    changeLayerProperty: changeLayerProperty
})(Oereb2Document);
