import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import fs from 'fs';
import { createCanvas } from 'canvas';
import { jsPDF } from 'jspdf';
import { loadPyodide } from 'pyodide';

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('dist'));

app.post('/api/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  try {
    const data = await parseCSV(req.file.path);
    const analysis = await analyzeData(data);
    const pdf = await generatePDF(analysis);

    res.contentType('application/pdf');
    res.send(pdf);

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).send(`An error occurred while processing the file: ${error.message}`);
  }
});

async function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true }))
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

async function analyzeData(data) {
  try {
    const pyodide = await loadPyodide();
    await pyodide.loadPackage(['pandas', 'numpy']);

    const analysis = pyodide.runPython(`
      import pandas as pd
      import numpy as np
      import json

      df = pd.DataFrame(${JSON.stringify(data)})

      # Convert columns to numeric where possible
      for col in df.columns:
          df[col] = pd.to_numeric(df[col], errors='ignore')

      summary = df.describe().to_dict()
      column_types = df.dtypes.astype(str).to_dict()
      missing_values = df.isnull().sum().to_dict()

      numeric_columns = df.select_dtypes(include=[np.number]).columns
      correlations = df[numeric_columns].corr().to_dict() if len(numeric_columns) > 1 else {}

      result = {
        'summary': summary,
        'column_types': column_types,
        'missing_values': missing_values,
        'correlations': correlations,
      }

      json.dumps(result)
    `);

    return JSON.parse(analysis);
  } catch (error) {
    console.error('Error in analyzeData:', error);
    throw error;
  }
}

async function generatePDF(analysis) {
  const doc = new jsPDF();
  let yOffset = 10;

  // Add title
  doc.setFontSize(20);
  doc.text('Data Analysis Report', 105, yOffset, { align: 'center' });
  yOffset += 15;

  // Add summary statistics
  doc.setFontSize(16);
  doc.text('Summary Statistics', 10, yOffset);
  yOffset += 10;

  doc.setFontSize(12);
  for (const [column, stats] of Object.entries(analysis.summary)) {
    doc.text(`${column}:`, 10, yOffset);
    yOffset += 5;
    for (const [stat, value] of Object.entries(stats)) {
      doc.text(`  ${stat}: ${typeof value === 'number' ? value.toFixed(2) : value}`, 10, yOffset);
      yOffset += 5;
    }
    yOffset += 5;
  }

  // Add column types
  yOffset += 10;
  doc.setFontSize(16);
  doc.text('Column Types', 10, yOffset);
  yOffset += 10;

  doc.setFontSize(12);
  for (const [column, type] of Object.entries(analysis.column_types)) {
    doc.text(`${column}: ${type}`, 10, yOffset);
    yOffset += 5;
  }

  // Add missing values
  yOffset += 10;
  doc.setFontSize(16);
  doc.text('Missing Values', 10, yOffset);
  yOffset += 10;

  doc.setFontSize(12);
  for (const [column, count] of Object.entries(analysis.missing_values)) {
    doc.text(`${column}: ${count}`, 10, yOffset);
    yOffset += 5;
  }

  // Add correlation heatmap
  if (Object.keys(analysis.correlations).length > 0) {
    yOffset += 10;
    doc.setFontSize(16);
    doc.text('Correlation Heatmap', 10, yOffset);
    yOffset += 10;

    const heatmapCanvas = createCorrelationHeatmap(analysis.correlations);
    doc.addImage(heatmapCanvas.toDataURL(), 'PNG', 10, yOffset, 190, 100);
  }

  return doc.output();
}

function createCorrelationHeatmap(correlations) {
  const canvas = createCanvas(600, 400);
  const ctx = canvas.getContext('2d');

  const columns = Object.keys(correlations);
  const cellSize = Math.min(500 / columns.length, 50);
  const xOffset = 80;
  const yOffset = 50;

  // Draw heatmap cells
  columns.forEach((col1, i) => {
    columns.forEach((col2, j) => {
      const value = correlations[col1][col2];
      const color = getCorrelationColor(value);
      ctx.fillStyle = color;
      ctx.fillRect(xOffset + i * cellSize, yOffset + j * cellSize, cellSize, cellSize);

      // Add correlation value text
      ctx.fillStyle = 'black';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(value.toFixed(2), xOffset + (i + 0.5) * cellSize, yOffset + (j + 0.5) * cellSize);
    });
  });

  // Add column labels
  ctx.fillStyle = 'black';
  ctx.font = '12px Arial';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  columns.forEach((col, i) => {
    ctx.fillText(col, xOffset - 5, yOffset + (i + 0.5) * cellSize);
    ctx.save();
    ctx.translate(xOffset + (i + 0.5) * cellSize, yOffset - 5);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(col, 0, 0);
    ctx.restore();
  });

  return canvas;
}

function getCorrelationColor(value) {
  const r = Math.floor(255 * (1 - Math.abs(value)));
  const g = Math.floor(255 * (1 - Math.abs(value)));
  const b = Math.floor(255);
  return `rgb(${r},${g},${b})`;
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});