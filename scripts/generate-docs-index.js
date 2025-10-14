#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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
        
        console.log(`Generated index with ${markdownFiles.length} documents:`);
        markdownFiles.forEach(file => console.log(`  - ${file}`));
        
        return markdownFiles;
    } catch (error) {
        console.error('Error generating docs index:', error);
        process.exit(1);
    }
}

// Run the function
if (require.main === module) {
    generateDocsIndex();
}

module.exports = { generateDocsIndex };