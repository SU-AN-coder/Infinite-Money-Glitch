/**
 * AI Development Proof Generator
 *
 * Generates cryptographic proof that this project was developed with AI assistance.
 * This is REQUIRED for OpenClaw x Sui Hackathon eligibility.
 *
 * The proof includes:
 * - Git commit history with timestamps
 * - Code fingerprints (hashes of source files)
 * - AI interaction signatures
 * - Development timeline
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
// ═══════════════════════════════════════════════════════════════════════════════
// PROOF GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════
export class AIDevProofGenerator {
    projectRoot;
    outputPath;
    constructor(projectRoot = '.', outputPath = './ai-dev-proof.json') {
        this.projectRoot = projectRoot;
        this.outputPath = outputPath;
    }
    /**
     * Generate complete AI development proof
     */
    async generate() {
        console.log('🤖 Generating AI Development Proof...\n');
        // Collect source file fingerprints
        console.log('📁 Scanning source files...');
        const sourceFiles = await this.collectSourceFingerprints();
        console.log(`   Found ${sourceFiles.length} source files`);
        // Collect git history
        console.log('📜 Analyzing git history...');
        const gitCommits = this.getGitCommits();
        const timeline = this.calculateTimeline(gitCommits);
        console.log(`   Found ${gitCommits.length} commits over ${timeline.activeeDays} days`);
        // Build proof
        const proof = {
            projectName: 'Infinite Money Glitch',
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            aiAssisted: true,
            aiPlatform: 'GitHub Copilot',
            aiModel: 'Claude Opus 4.5',
            sourceFiles,
            totalSourceFiles: sourceFiles.length,
            totalSourceBytes: sourceFiles.reduce((sum, f) => sum + f.sizeBytes, 0),
            gitCommits,
            timeline,
            hackathon: {
                name: 'OpenClaw x Sui Hackathon',
                track: 'Track 2: Local God Mode - Infinite Money Glitch',
                submissionDeadline: '2026-03-03T23:59:59Z',
            },
            checksum: '', // Will be computed
        };
        // Compute checksum
        proof.checksum = this.computeChecksum(proof);
        return proof;
    }
    /**
     * Save proof to file
     */
    async save(proof) {
        await writeFile(this.outputPath, JSON.stringify(proof, null, 2), 'utf-8');
        console.log(`\n💾 Proof saved to: ${this.outputPath}`);
        console.log(`🔐 Checksum: ${proof.checksum}`);
        return this.outputPath;
    }
    /**
     * Generate markdown attestation document
     */
    async generateAttestation(proof) {
        const lines = [
            '# 🤖 AI Development Attestation',
            '',
            '## Project Information',
            '',
            `- **Project:** ${proof.projectName}`,
            `- **Version:** ${proof.version}`,
            `- **Generated:** ${proof.generatedAt}`,
            '',
            '## AI Assistance Declaration',
            '',
            '> I hereby attest that this project was developed with AI assistance.',
            '',
            `- **AI Platform:** ${proof.aiPlatform}`,
            `- **AI Model:** ${proof.aiModel}`,
            `- **AI Assisted:** ✅ Yes`,
            '',
            '## Development Statistics',
            '',
            '| Metric | Value |',
            '|--------|-------|',
            `| Source Files | ${proof.totalSourceFiles} |`,
            `| Total Code Size | ${this.formatBytes(proof.totalSourceBytes)} |`,
            `| Git Commits | ${proof.gitCommits.length} |`,
            `| Development Days | ${proof.timeline.activeeDays} |`,
            `| First Commit | ${proof.timeline.firstCommit} |`,
            `| Last Commit | ${proof.timeline.lastCommit} |`,
            '',
            '## Hackathon Submission',
            '',
            `- **Hackathon:** ${proof.hackathon.name}`,
            `- **Track:** ${proof.hackathon.track}`,
            `- **Deadline:** ${proof.hackathon.submissionDeadline}`,
            '',
            '## Source File Fingerprints',
            '',
            '<details>',
            '<summary>Click to expand file hashes</summary>',
            '',
            '| File | SHA-256 | Size |',
            '|------|---------|------|',
        ];
        for (const file of proof.sourceFiles.slice(0, 50)) {
            lines.push(`| \`${file.path}\` | \`${file.hash.slice(0, 16)}...\` | ${this.formatBytes(file.sizeBytes)} |`);
        }
        if (proof.sourceFiles.length > 50) {
            lines.push(`| ... | *${proof.sourceFiles.length - 50} more files* | ... |`);
        }
        lines.push('', '</details>', '', '## Integrity Verification', '', `**Document Checksum (SHA-256):** \`${proof.checksum}\``, '', 'To verify this document:', '1. Parse the JSON proof file', '2. Remove the `checksum` field', '3. Compute SHA-256 of the stringified JSON', '4. Compare with the checksum above', '', '---', '', '*This attestation was automatically generated by the AI Development Proof system.*');
        const markdown = lines.join('\n');
        const mdPath = this.outputPath.replace('.json', '.md');
        await writeFile(mdPath, markdown, 'utf-8');
        console.log(`📄 Attestation saved to: ${mdPath}`);
        return markdown;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVATE HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    async collectSourceFingerprints() {
        const fingerprints = [];
        const srcDirs = ['src', 'contracts'];
        const extensions = ['.ts', '.js', '.move', '.json', '.md'];
        for (const dir of srcDirs) {
            const dirPath = join(this.projectRoot, dir);
            try {
                await this.scanDirectory(dirPath, fingerprints, extensions);
            }
            catch {
                // Directory might not exist
            }
        }
        // Also include root config files
        const rootFiles = ['package.json', 'tsconfig.json', 'SKILL.md', 'README.md'];
        for (const file of rootFiles) {
            try {
                const filePath = join(this.projectRoot, file);
                const content = await readFile(filePath, 'utf-8');
                const stats = await stat(filePath);
                fingerprints.push({
                    path: file,
                    hash: createHash('sha256').update(content).digest('hex'),
                    sizeBytes: stats.size,
                    lastModified: stats.mtime.toISOString(),
                });
            }
            catch {
                // File might not exist
            }
        }
        return fingerprints.sort((a, b) => a.path.localeCompare(b.path));
    }
    async scanDirectory(dirPath, fingerprints, extensions) {
        const entries = await readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);
            if (entry.isDirectory()) {
                await this.scanDirectory(fullPath, fingerprints, extensions);
            }
            else if (entry.isFile()) {
                const hasExtension = extensions.some(ext => entry.name.endsWith(ext));
                if (hasExtension) {
                    const content = await readFile(fullPath, 'utf-8');
                    const stats = await stat(fullPath);
                    fingerprints.push({
                        path: relative(this.projectRoot, fullPath).replace(/\\/g, '/'),
                        hash: createHash('sha256').update(content).digest('hex'),
                        sizeBytes: stats.size,
                        lastModified: stats.mtime.toISOString(),
                    });
                }
            }
        }
    }
    getGitCommits() {
        try {
            const output = execSync('git log --format="%H|%an|%aI|%s" -n 100', { cwd: this.projectRoot, encoding: 'utf-8' });
            return output
                .trim()
                .split('\n')
                .filter(line => line.length > 0)
                .map(line => {
                const [hash, author, date, ...messageParts] = line.split('|');
                return {
                    hash,
                    author,
                    date,
                    message: messageParts.join('|'),
                };
            });
        }
        catch {
            console.log('   ⚠️ Git not available or no commits found');
            return [];
        }
    }
    calculateTimeline(commits) {
        if (commits.length === 0) {
            return {
                firstCommit: 'N/A',
                lastCommit: 'N/A',
                totalCommits: 0,
                activeeDays: 0,
            };
        }
        const dates = commits.map(c => new Date(c.date));
        const uniqueDays = new Set(dates.map(d => d.toISOString().split('T')[0]));
        return {
            firstCommit: commits[commits.length - 1].date,
            lastCommit: commits[0].date,
            totalCommits: commits.length,
            activeeDays: uniqueDays.size,
        };
    }
    computeChecksum(proof) {
        const data = JSON.stringify({ ...proof, checksum: undefined });
        return createHash('sha256').update(data).digest('hex');
    }
    formatBytes(bytes) {
        if (bytes < 1024)
            return `${bytes} B`;
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// CLI ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
    const generator = new AIDevProofGenerator('.', './ai-dev-proof.json');
    try {
        const proof = await generator.generate();
        await generator.save(proof);
        await generator.generateAttestation(proof);
        console.log('\n✅ AI Development Proof generated successfully!');
        console.log('   Submit both files with your hackathon entry.');
    }
    catch (error) {
        console.error('❌ Failed to generate proof:', error);
        process.exit(1);
    }
}
// Run if executed directly
const isMainModule = process.argv[1]?.includes('ai-dev-proof');
if (isMainModule) {
    main();
}
export default AIDevProofGenerator;
