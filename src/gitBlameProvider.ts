import {Disposable, Range, Uri, workspace} from 'vscode';
import {DocumentSchemes} from './constants';
import {gitBlame} from './git';
import {basename, dirname, extname, join} from 'path';
import * as moment from 'moment';
import * as _ from 'lodash';

const blameMatcher = /^([\^0-9a-fA-F]{8})\s([\S]*)\s+([0-9\S]+)\s\((.*)\s([0-9]{4}-[0-9]{2}-[0-9]{2}\s[0-9]{2}:[0-9]{2}:[0-9]{2}\s[-|+][0-9]{4})\s+([0-9]+)\)(.*)$/gm;

export default class GitBlameProvider extends Disposable {
    private _files: Map<string, Promise<IGitBlame>>;
    private _subscriptions: Disposable;

    constructor() {
        super(() => this.dispose());

        this._files = new Map();
        this._subscriptions = Disposable.from(workspace.onDidCloseTextDocument(d => this._removeFile(d.fileName)),
                                              workspace.onDidChangeTextDocument(e => this._removeFile(e.document.fileName)));
    }

    dispose() {
        this._files.clear();
        this._subscriptions && this._subscriptions.dispose();
        super.dispose();
    }

    blameFile(fileName: string) {
        let blame = this._files.get(fileName);
        if (blame !== undefined) return blame;

        blame = gitBlame(fileName)
            .then(data => {
                const commits: Map<string, IGitBlameCommit> = new Map();
                const lines: Array<IGitBlameLine> = [];
                let m: Array<string>;
                while ((m = blameMatcher.exec(data)) != null) {
                    let sha = m[1];
                    if (!commits.has(sha)) {
                        commits.set(sha, {
                            sha,
                            fileName: m[2].trim(),
                            author: m[4].trim(),
                            date: new Date(m[5])
                        });
                    }

                    lines.push({
                        sha,
                        originalLine: parseInt(m[3], 10) - 1,
                        line: parseInt(m[6], 10) - 1
                        //code: m[7]
                    });
                }

                return { commits, lines };
            });
            // .catch(ex => {
            //     console.error(ex);
            // });

        this._files.set(fileName, blame);
        return blame;
    }

    getBlameForRange(fileName: string, range: Range): Promise<IGitBlame> {
        return this.blameFile(fileName).then(blame => {
            if (!blame.lines.length) return blame;

            const lines = blame.lines.slice(range.start.line, range.end.line + 1);
            const commits = new Map();
            _.uniqBy(lines, 'sha').forEach(l => commits.set(l.sha, blame.commits.get(l.sha)));

            return { commits, lines };
        });
    }

    getBlameForShaRange(fileName: string, sha: string, range: Range): Promise<{commit: IGitBlameCommit, lines: IGitBlameLine[]}> {
        return this.blameFile(fileName).then(blame => {
            return {
                commit: blame.commits.get(sha),
                lines: blame.lines.slice(range.start.line, range.end.line + 1).filter(l => l.sha === sha)
            };
        });
    }

    private _removeFile(fileName: string) {
        this._files.delete(fileName);
    }

    static toBlameUri(repoPath: string, commit: IGitBlameCommit, range: Range, index: number, commitCount: number) {
        const pad = n => ("0000000" + n).slice(-("" + commitCount).length);

        const ext = extname(commit.fileName);
        const path = `${dirname(commit.fileName)}/${commit.sha}: ${basename(commit.fileName, ext)}${ext}`;
        const data: IGitBlameUriData = { fileName: join(repoPath, commit.fileName), sha: commit.sha, range: range, index: index };
        // NOTE: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
        return Uri.parse(`${DocumentSchemes.GitBlame}:${pad(index)}. ${commit.author}, ${moment(commit.date).format('MMM D, YYYY hh:MMa')} - ${path}?${JSON.stringify(data)}`);
    }

    static fromBlameUri(uri: Uri): IGitBlameUriData {
        const data = JSON.parse(uri.query);
        data.range = new Range(data.range[0].line, data.range[0].character, data.range[1].line, data.range[1].character);
        return data;
    }
}

export interface IGitBlame {
    commits: Map<string, IGitBlameCommit>;
    lines: IGitBlameLine[];
}

export interface IGitBlameCommit {
    sha: string;
    fileName: string;
    author: string;
    date: Date;
}
export interface IGitBlameLine {
    sha: string;
    originalLine: number;
    line: number;
    code?: string;
}
export interface IGitBlameUriData {
    fileName: string,
    sha: string,
    range: Range,
    index: number
}