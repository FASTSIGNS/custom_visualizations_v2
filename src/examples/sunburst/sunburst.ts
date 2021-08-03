import * as d3 from 'd3'
import { formatType, handleErrors } from '../common/utils'

import {
  Link,
  Looker,
  LookerChartUtils,
  Row,
  VisConfig,
  VisualizationDefinition
} from '../types/types'

// Global values provided via the API
declare var looker: Looker
declare var LookerCharts: LookerChartUtils

const colorBy = {
  NODE: 'node',
  ROOT: 'root'
}

interface SunburstVisualization extends VisualizationDefinition {
  svg?: any,
}

// recursively create children array
function descend(obj: any, depth: number = 0) {
  const arr: any[] = []
  for (const k in obj) {
    if (k === '__data') {
      continue
    }
    const child: any = {
      name: k,
      depth,
      children: descend(obj[k], depth + 1)
    }
    if ('__data' in obj[k]) {
      child.data = obj[k].__data
      child.links = obj[k].__data.taxonomy.links
    }
    arr.push(child)
  }
  return arr
}

//track total TODO
let totalSize = 0

function burrow(table: Row[], config: VisConfig) {
  // create nested object
  const obj: any = {}

  table.forEach((row: Row) => {
    // start at root
    let layer = obj

    // create children as nested objects
    row.taxonomy.value.forEach((key: any) => {
      if (key === null && !config.show_null_points) {
        return
      }
      layer[key] = key in layer ? layer[key] : {}
      layer = layer[key]
    })
    layer.__data = row

    console.log(layer.__data)
  })

  // use descend to create nested children arrays
  return {
    name: 'root',
    children: descend(obj, 1),
    depth: 0,
    value: 0
  }
}

const getLinksFromRow = (row: Row): Link[] => {
  return Object.keys(row).reduce((links: Link[], datum) => {
    if (row[datum].links) {
      const datumLinks = row[datum].links as Link[]
      return links.concat(datumLinks)
    } else {
      return links
    }
  }, [])
}

const vis: SunburstVisualization = {
  id: 'sunburst', // id/label not required, but nice for testing and keeping manifests in sync
  label: 'Sunburst',
  options: {
    color_range: {
      type: 'array',
      label: 'Color Range',
      display: 'colors',
      default: ['#dd3333', '#80ce5d', '#f78131', '#369dc1', '#c572d3', '#36c1b3', '#b57052', '#ed69af']
    },
    color_by: {
      type: 'string',
      label: 'Color By',
      display: 'select',
      values: [
        { 'Color By Root': colorBy.ROOT },
        { 'Color By Node': colorBy.NODE }
      ],
      default: colorBy.ROOT
    },
    show_percentage: {
      type: 'boolean',
      label: 'Percent on Hover',
      default: true
    },
    show_null_points: {
      type: 'boolean',
      label: 'Plot Null Values',
      default: true
    }
  },

  // Set up the initial state of the visualization
  create(element, _config) {
    element.style.fontFamily = `"Courier New", "Mono", mono`
    this.svg = d3.select(element).append('svg')
  },

  // Render in response to the data or settings changing
  update(data, element, config, queryResponse) {
    if (!handleErrors(this, queryResponse, {
      min_pivots: 0, max_pivots: 0,
      min_dimensions: 1, max_dimensions: undefined,
      min_measures: 1, max_measures: 1
    })) return

    const width = element.clientWidth
    const height = element.clientHeight - 15
    const radius = Math.min(width, height) / 2 - 8

    const dimensions = queryResponse.fields.dimension_like
    const measure = queryResponse.fields.measure_like[0]
    const format = formatType(measure.value_format) || ((s: any): string => s.toString())

    const colorScale: d3.ScaleOrdinal<string, null> = d3.scaleOrdinal()
    const color = colorScale.range(config.color_range || [])

    data.forEach(row => {
      row.taxonomy = {
        links: getLinksFromRow(row),
        value: dimensions.map((dimension) => row[dimension.name].value)
      }
    })

    const partition = d3.partition().size([2 * Math.PI, radius * radius])

    const arc = (
      d3.arc()
      .startAngle((d: any) => d.x0)
      .endAngle((d: any) => d.x1)
      .innerRadius((d: any) => Math.sqrt(d.y0))
      .outerRadius((d: any) => Math.sqrt(d.y1))
    )

    const main = (
      this.svg
      .html('')
      .attr('width', '100%')
      .attr('height', '100%')
    )

    const svg = (
      main
      .append('g')
      .attr('transform', 'translate(' + width / 2 + ',' + ((height / 2) + 25) + ')')
    )

    // create and position breadcrumbs container and svg
    const breadcrumbs =
    main
    .append("g")
    .attr("x", '10')
    .attr("y", '10')

    var b = {
      w: 60,
      h: 30,
      s: 3,
      t: 10
    };

    function breadcrumbPoints(d:any, i:any) {
      // the 5 is important for proper spacing between polygons
      const l = (d.data.name.length * 7.5) + b.t - 5
      var points = [];
      points.push("0,0");
      points.push(l + ",0");
      points.push(l+ b.t + "," + (b.h / 2));
      points.push(l + "," + b.h);
      points.push("0," + b.h);
  
      if (i > 0) { // Leftmost breadcrumb; don't include 6th vertex.
        points.push(b.t + "," + (b.h / 2));
      }
      return points.join(" ");
    }

    const label = svg
      .append("text")
      .attr("text-anchor", "middle")
      .attr("fill", "#888")
      .style("visibility", "hidden");

    label
      .append("tspan")
      .attr("class", "percentage")
      .attr("x", 0)
      .attr("y", 25)
      .attr("dy", "-0.1em")
      .attr("font-size", "3em")
      .text("");

    function updateBreadcrumbs(ancestors: any, percentageString: any) {
      // Data join, where primary key = name + depth.
      let w = 0
      breadcrumbs.selectAll('g').remove()
      breadcrumbs.selectAll('text').remove()

      var g = breadcrumbs.selectAll("g")
        .data(ancestors, function(d:any) {
          return d;
        })
        .enter()
        .append("g")
        .attr("transform",function(d:any,i:any) {
          const a = w
          w = w + (d.data.name.length *7.5) + b.t
          return 'translate(' + a + ',0)'
        });
  
      // Add breadcrumb and label for entering nodes.
      
      //var breadcrumb = g.enter().append("g");

      var lastCrumb = breadcrumbs.append("text").classed("lastCrumb", true);
  
      g
        .append("polygon").classed("breadcrumbs-shape", true)
        .attr("points", breadcrumbPoints)
        .attr('fill', (d: any) => {
          if (d.depth === 0) return 'none'
          if (config.color_by === colorBy.NODE) {
            return color(d.data.name)
          } else {
            return color(d.ancestors().map((p: any) => p.data.name).slice(-2, -1))
          }
        })
  
      g
        .append("text").classed("breadcrumbs-text", true)
        .attr("x", b.t + 5)
        .attr("y", b.h / 2)
        .attr("dy", "0.35em")
        .attr("font-size", "12px")
        .attr("font-weight", "bold")
        .text(function(d:any) {
          return d.data.name;
        });
  
      // Remove exiting nodes.
      g.exit().remove();
  
      // Update percentage at the lastCrumb.
      lastCrumb
        .attr("x", (w + 35))
        .attr("y", b.h / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "right")
        .attr("fill", "black")
        .attr("font-weight", "bold")
        .text(percentageString);
    }


    const root = d3.hierarchy(burrow(data, config)).sum((d: any) => {
      return 'data' in d ? d.data[measure.name].value : 0
    })
    const rp = partition(root)

    svg
    .selectAll('path')
    .data(root.descendants())
    .enter()
    .append('path')
    .attr('d', arc)
    .style('fill', (d: any) => {
      if (d.depth === 0) return 'none'
      if (config.color_by === colorBy.NODE) {
        return color(d.data.name)
      } else {
        return color(d.ancestors().map((p: any) => p.data.name).slice(-2, -1))
      }
    })
    .style('fill-opacity', (d: any) => 1 - d.depth * 0.15)
    .style('transition', (d: any) => 'fill-opacity 0.5s')
    .style('stroke', (d: any) => '#fff')
    .style('stroke-width', (d: any) => '0.5px')
    .on('click', function (this: any, d: any) {
      const event: object = { pageX: d3.event.pageX, pageY: d3.event.pageY }
      LookerCharts.Utils.openDrillMenu({
        links: d.data.links,
        event: event
      })
    })
    .on('mouseenter', function(d: any) {
      const ancestorText = (
        d.ancestors()
        .map((p: any) => p.data.name)
        .slice(0, -1)
        .reverse()
        .join('-')
      )

      const sequence = d.ancestors().map((p:any) => p).slice(0,-1).reverse()
      const percentage = root.value ? ((100 * d.value) / root.value ).toPrecision(3).toString()+'%': null;
      // const percentage = format(d.value)
      updateBreadcrumbs(sequence, format(d.value));

      const ancestors = d.ancestors()

      label
        .style("visibility", null)
        .select(".percentage")
        .text( config.show_percentage?  percentage: format(d.value))
        .attr("font-weight", "bold");

      svg
      .selectAll('path')
      .style('fill-opacity', (p: any) => {
        return ancestors.indexOf(p) > -1 ? 1 : 0.15
      })
    })
    .on('mouseleave', (d: any) => {
      svg
      .selectAll('path')
      .style('fill-opacity', (d: any) => 1 - d.depth * 0.15)

      label.style("visibility", "hidden")
      updateBreadcrumbs([], '');
    })
  }
}

looker.plugins.visualizations.add(vis)
