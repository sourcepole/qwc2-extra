Extra components for QWC2
=========================

This repository contains extra components for QWC2.

* [PlotInfoTool](#plotinfotool)
* [SensorThingsTool](#sensorthingstool)


NOTE: add this directory to the QWC2 App workspaces in `package.json`:
```jsonc
    // ...
    "workspaces": [
        "qwc2",
        "qwc2-extra"
    ]
    // ...
```


PlotInfoTool
------------

Plugin for requesting plot information, including Swiss Public-law Restrictions on landownership (PLR) cadastre.

**`config.json` configuration:**

    [...]
    {
      "name": "PlotInfoTool",
      "cfg": {
        "toolLayers": ["Grundstücke"],
        "infoQueries": [
          {
            "key": "oereb",
            "titleMsgId": "oereb.title",
            "query": "/oereb/json/$egrid$",
            "pdfQuery": "/oereb/pdf/$egrid$",
            "pdfTooltip": "oereb.requestPdf",
            "urlKey": "oereb_egrid",
            "cfg": {
              "subthemes": {
                "LandUsePlans": ["Grundnutzung", "Überlagerungen", "Linienbezogene Festlegungen", "Objektbezogene Festlegungen"]
              }
            }
          }
        ]
      }
    }
    [...]

 * `toolLayers`: List of layers to load when activating tool.
 * `infoQueries`: List of additional info queries to offer in the dialog (PLR cadastre query is built-in). By default, these render some HTML data in an iframe. If a custom component is needed for rendering the result, see configuration in `appConfig.js` below.
   - `key`: A unique key name.
   - `title`: The human visible title.
   - `titleMsgId`: Instead of `title`, a message id for the title which will be looked up in the translations.
   - `query`: The query to perform to retreive the info. Must return HTML, which is then rendered in an iframe. `$egrid$` is replaced with the EGRID of the current plot. If the specified URL is relative, it is resolved with respect to `plotInfoService` as defined in `config.json`.
   - `pdfQuery`: Optional query to retreive a PDF report, which is then presented as a download the the user. Again, `$egrid$` is replaced with the EGRID of the current plot.
   - `pdfTooltip`: Message id for the pdf button tooltip.
   - `urlKey`: Optional query parameter key name. If QWC2 is started with `<urlKey>=<egrid>` in the URL, the plot info tool is automatically enabled and the respective query performed.
   - `cfg`: Arbitrary custom config to pass to a custom component, see `appConfig.js` configuration below.

**`appConfig.js` configuration:**

Sample `PlotInfoToolPlugin` configuration, as can be defined in the `cfg` section of `pluginsDef` in `appConfig.js`:

    PlotInfoToolPlugin: {
      themeLayerRestorer: require('./themeLayerRestorer'),
      customInfoComponents: {
          oereb: require('qwc2-extra/components/OerebDocument')
      }
    }

 * `themeLayerRestorer`: Function which restores theme layers, used for loading the `toolLayers` specified in the configuration in `config.json`. See `themeLayerRestorer` in the [sample `appConfig.js`](https://github.com/qgis/qwc2-demo-app/blob/master/js/appConfig.js).
 * `customInfoComponents`: Customized components for rendering plot info query results. The `key` specifies a the info query for which this component should be used, as specified in `infoQueries` in config.json (see above). An example of a minimal custom component:

       class CustomPlotInfoComponent extends React.Component {
         static propTypes = {
           data: PropTypes.object, // PropType according to format of data returned by the specified query URL
           config: PropTypes.object // Custom configuration
         }
         render() {
           return (<div>{this.props.data.field}</div>);
         }
       };

       module.exports = CustomPlotInfoComponent;


SensorThingsTool
----------------

Plugin for querying observations from a SensorThings API server and displaying them as a graph.


### Configuration

#### `config.json`
```jsonc
{
  // ...
  "plugins": {
    "common": [
      // ...
      {
        "name": "TopBar",
        "cfg": {
          "menuItems": [
            // ...
            {"key": "SensorThingsTool", "icon": "plot_info"},
            // ...
          ]
      },
      // ...
      {
        "name": "SensorThingsTool",
        "cfg": {
          "sensorThingsApiUrl": "https://airquality-frost.k8s.ilt-dmz.iosb.fraunhofer.de/v1.1",
          "queryTolerance": 16,
          "windowSize": {
            "width": 800, "height": 500
          }
        }
      },
      // ...
    ],
    // ...
  }
  // ...
}
```

* `sensorThingsApiUrl`: Base URL of SensorThings API
* `queryTolerance` (optional, default: `16`): Tolerance in pixels around query position
* `windowSize` (optional, default: 800x500): Inital window size


#### `appConfig.js`

Import and include `SensorThingsToolPlugin` in `appConfig.js`:
```javascript
// ...

import SensorThingsToolPlugin from 'qwc2-extra/plugins/SensorThingsTool';

// ...

export default {
    // ...
    pluginsDef: {
        plugins: {
            // ...
            SensorThingsToolPlugin: SensorThingsToolPlugin
            // ...
        }
    },
    // ...
};
```
