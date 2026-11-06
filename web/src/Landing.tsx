import { Mark } from "./Mark";

const VSIX = "/session-ide-0.1.0.vsix";

export function Landing() {
  return (
    <div className="page">
      <header className="mast">
        <a className="brand" href="/">
          <Mark />
          <span className="word">session</span>
        </a>
        <a className="nav" href="/room">
          The table
        </a>
      </header>

      <h1 className="lede">
        P2P connect
        <br />
        inside your agentic session.
      </h1>
      <p className="deck">
        You come back to the session. Someone else takes the other one. Play them, or solve a
        puzzle. A win credits the prompt your agent is working on.
      </p>

      <div className="download">
        <a className="primary" href={VSIX}>
          Download for Cursor
        </a>
        <p className="hint">Version 0.1.0. A .vsix file. Cursor and VS Code.</p>
      </div>

      <section className="install">
        <h2>Install</h2>
        <p>
          In Cursor, open the command palette and choose{" "}
          <span className="command">Extensions: Install from VSIX…</span> Point it at the file you
          just downloaded. The Session mark appears in the activity bar.
        </p>
      </section>

      <section className="about">
        <h2>In the room</h2>
        <dl className="define">
          <div>
            <dt>Play</dt>
            <dd>Chess and snakes, between two sessions. You have the controls on yours.</dd>
          </div>
          <div>
            <dt>Puzzles</dt>
            <dd>A sudoku, a mate, a maze. Something to finish while the agent keeps going.</dd>
          </div>
          <div>
            <dt>Credit</dt>
            <dd>A win counts only while the agent is working. Claim it when that turn finishes.</dd>
          </div>
        </dl>
        <p className="closing">
          <a className="textlink" href="/room">
            The table
          </a>{" "}
          is the public view of who is here.
        </p>
      </section>
    </div>
  );
}
