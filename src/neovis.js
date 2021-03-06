'use strict';

import * as neo4j from '../vendor/neo4j-javascript-driver/lib/browser/neo4j-web.js';
import * as vis from '../vendor/vis/dist/vis.min.js';
import '../vendor/vis/dist/vis-network.min.css';
import defaults from './defaults';


export default class NeoVis {

    /**
     *
     * @constructor
     * @param {object} config - configures the visualization and Neo4j server connection
     *  {
     *    container:
     *    server_url:
     *    server_password?:
     *    server_username?:
     *    labels:
     *
     *  }
     *
     */

    constructor(config) {
        this._config = config;
        this._driver = neo4j.v1.driver(config.server_url || defaults.neo4j.neo4jUri, neo4j.v1.auth.basic(config.server_user || defaults.neo4j.neo4jUser, config.server_password || defaults.neo4j.neo4jPassword));
        this._query =   config.initial_cypher || defaults.neo4j.initialQuery;
        this._nodes = new vis.DataSet();
        this._edges = new vis.DataSet();
        this._data = {
            "nodes": this._nodes,
            "edges": this._edges
        };
        this._network = null;
        this._container = document.getElementById(config.container_id);


    }

    /**
     * Build node object for vis from a neo4j Node
     * FIXME: use config
     * FIXME: move to private api
     * @param n
     * @returns {{}}
     */
     buildNodeVisObject(n) {

        var self = this;
        let node = {};
        let label = n.labels[0];

        let captionKey   = this._config.labels[label]['caption'],
            sizeKey      = this._config.labels[label]['size'],
            sizeCypher   = this._config.labels[label]['sizeCypher'],
            communityKey = this._config.labels[label]['community'];


        node['id'] = n.identity.toInt();
        
        // node size

        if (sizeCypher) {
            // use a cypher statement to determine the size of the node
            // the cypher statement will be passed a parameter {id} with the value
            // of the internal node id

            let session = this._driver.session();
            session.run(sizeCypher, {id: neo4j.v1.int(node['id'])})
                .then(function(result) {
                    result.records.forEach(function(record) {
                        record.forEach(function(v,k,r) {
                            if (typeof v === "number") {
                                self._nodes.update({id: node['id'], value: v});
                            } else if (v.constructor.name === "Integer") {
                                self._nodes.update({id: node['id'], value: v.toNumber()});
                            }
                        })
                    })
                })


        } else if (typeof sizeKey === "number") {
            node['value'] = sizeKey;
        } else {

            let sizeProp = n.properties[sizeKey];

            if (sizeProp && typeof sizeProp === "number") {
                // propety value is a number, OK to use
                node['value'] = sizeProp;
            } else if (sizeProp && typeof sizeProp === "object" && sizeProp.constructor.name === "Integer") {
                // property value might be a Neo4j Integer, check if we can call toNumber on it:
                if (sizeProp.inSafeRange()) {
                    node['value'] = sizeProp.toNumber();
                } else {
                    // couldn't convert to Number, use default
                    node['value'] = 1.0;
                }
            } else {
                node['value'] = 1.0;
            }
        }

        // node caption
        node['label'] = n.properties[captionKey] || label || "";

        // community
        // behavior: color by value of community property (if set in config), then color by label
        if (!communityKey) {
            node['group'] = label;
        } else {
            node['group'] = n.properties[communityKey].toNumber() || label || 0;  // FIXME: cast to Integer
        }


        // set all properties as tooltip
        node['title'] = "";
        for (let key in n.properties) {
            node['title'] += "<strong>" + key + ":</strong>" + " " + n.properties[key] + "<br>";
        }
        return node;
    }

    /**
     * Build edge object for vis from a neo4j Relationship
     * @param r
     * @returns {{}}
     */
    buildEdgeVisObject(r) {

        let weightKey = this._config && this._config.relationships && this._config.relationships[r.type] && this._config.relationships[r.type]['thickness'],
            captionKey = this._config && this._config.relationships && this._config.relationships[r.type] && this._config.relationships[r.type]['caption'];

        let edge = {};
        edge['id'] = r.identity.toInt();
        edge['from'] = r.start.toInt();
        edge['to'] = r.end.toInt();

        // hover tooltip. show all properties in the format <strong>key:</strong> value
        edge['title'] = "";
        for (let key in r.properties) {
            edge['title'] += "<strong>" + key + ":</strong>" + " " + r.properties[key] + "<br>";
        }

        // set relationship thickness
        if (weightKey && typeof weightKey === "string") {
            edge['value'] = r.properties[weightKey];
        } else if (weightKey && typeof weightKey === "number") {
            edge['value'] = weightKey;
        } else {
            edge['value'] = 1.0;
        }

        // set caption


        if (typeof captionKey === "boolean") {
            if (!captionKey) {
                edge['label'] = "";
            } else {
                edge['label'] = r.type;
            }
        } else if (captionKey && typeof captionKey === "string") {
            edge['label']  = captionKey;
        } else {
            edge['label'] = r.type;
        }

        return edge;
    }

    // public API

    render() {

        // connect to Neo4j instance
        // run query

        let self = this;

        let session = this._driver.session();
        session
            .run(this._query, {limit: 30})
            .subscribe({
                onNext: function (record) {
                    //console.log("CLASS NAME");
                    //console.log(record.constructor.name);
                    //console.log(record);

                    record.forEach(function(v, k, r) {
                    if (v.constructor.name === "Node") {
                        let node = self.buildNodeVisObject(v);
                        //console.log("adding node");

                        try {
                            //self._nodes.add(node);
                            self._nodes.update(node);
                        } catch(e) {
                            console.log(e);
                        }

                    }
                    else if (v.constructor.name === "Relationship") {

                        let edge = self.buildEdgeVisObject(v);

                        try {
                            self._edges.update(edge);
                        } catch(e) {
                            console.log(e);
                        }

                    }

                })
                },
                onCompleted: function () {
                  session.close();
                  let options = {
                    nodes: {
                        shape: 'dot',
                        font: {
                            size: 26,
                            strokeWidth: 7
                        },
                        scaling: {
                            label: {
                                enabled: true
                            }
                        }
                    },
                    edges: {
                        arrows: {
                            to: {enabled: self._config.arrows || false } // FIXME: handle default value
                        }
                    },
                    layout: {
                        improvedLayout: false
                    },
                    physics: {
                        enabled: true,
                        timestep: 0.4,
                        stabilization: true
                    }
                };

                var container = self._container;

                self._network = new vis.Network(container, self._data, options);
                
                console.log("completed");

                
                },
                onError: function (error) {
                  console.log(error);
                }

            })
        };

    /**
     * Clear the data for the visualization
     */
    clearNetwork() {
        this._nodes.clear();
        this._edges.clear();
        this._network.setData(this._data);
    }


    /**
     * Reset the config object and reload data
     * @param config
     */
    reinit(config) {

    };

    /**
     * Fetch live data form the server and reload the visualization
     */
    reload() {

        this.clearNetwork();
        this.render();

    };

    /**
     * Stabilize the visuzliation
     */
    stabilize() {
        this._network.stopSimulation();
        console.log("Calling stopSimulation");
    }

    /**
     * Execute an arbitrary Cypher query and re-render the visualization
     * @param query
     */
    renderWithCypher(query) {

        //self._config.initial_cypher = query;

        this.clearNetwork();
        this._query = query;
        this.render();

    };

    // configure exports based on environment (ie Node.js or browser)
    //if (typeof exports === 'object') {
    //    module.exports = NeoVis;
    //} else {
    //    define (function () {return NeoVis;})
    //}

}

