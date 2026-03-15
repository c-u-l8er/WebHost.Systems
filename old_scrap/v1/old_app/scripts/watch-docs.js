#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple watcher without external dependencies
const docsDir = path.join(__dirname, '../docs');
const indexPath = path.join(docsDir, 'index.json');

function generateDocsIndex() {
    try {
        console.log('Generating documentation index...');
        
        // Read all files in the docs directory
        const files = fs.readdirSync(docsDir);
        
        // Filter for .md files only, excluding index.json
        const markdownFiles = files
            .filter(file => file.endsWith('.md'))
            .sort();
        
        // Create the index object
        const index = {
            generated: new Date().toISOString(),
            documents: markdownFiles
        };
        
        // Write the index file
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
        
        console.log(`Updated index with ${markdownFiles.length} documents:`);
        markdownFiles.forEach(file => console.log(`  - ${file}`));
        
        return markdownFiles;
    } catch (error) {
        console.error('Error generating docs index:', error);
        process.exit(1);
    }
}

function watchDocs() {
    console.log('Watching docs folder for changes...');
    console.log('Press Ctrl+C to stop watching');
    
    // Initial generation
    generateDocsIndex();
    
    // Watch for changes
    fs.watch(docsDir, (eventType, filename) => {
        if (filename && filename.endsWith('.md')) {
            console.log(`\nDetected ${eventType}: ${filename}`);
            console.log('Regenerating documentation index...');
            generateDocsIndex();
            console.log('Index updated successfully!\n');
        }
    });
}

// Run the watcher
if (require.main === module) {
    watchDocs();
}

module.exports = { generateDocsIndex, watchDocs };