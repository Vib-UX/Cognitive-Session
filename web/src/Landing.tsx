import { Mark } from "./Mark";

const VSIX = "/session-ide-0.1.2.vsix";
const OVSX = "https://open-vsx.org/extension/session/session-ide";

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
        P2P connect inside
        <br />
        your agentic session.
      </h1>
      <p className="deck">
        User A’s agent has about 4 minutes left. User B’s has about 3. During that wait they
        battle inside the editor. The winner gets token credits that pay for the prompt.
      </p>

      <div className="download">
        <a className="primary" href={VSIX}>
          Download for Cursor
        </a>
        <p className="hint">Version 0.1.2. A .vsix file. Cursor and VS Code.</p>
      </div>

      <section className="install">
        <h2>Install</h2>
        <p>
          In Cursor, open the command palette and choose{" "}
          <span className="command">Extensions: Install from VSIX…</span> Point it at the file you
          just downloaded. The Session mark appears in the activity bar. The same extension is
          listed on{" "}
          <a className="textlink" href={OVSX}>
            Open VSX
          </a>
          .
        </p>
      </section>

      <section className="about">
        <h2>How it works</h2>
        <figure className="diagram">
          <div className="pair">
            <div className="seat">
              <p className="who">User A</p>
              <p className="task">Agent working on a prompt.</p>
              <p className="eta">
                4 min
                <small>left on the task</small>
              </p>
            </div>
            <p className="between">
              battle
              <span>inside the editor</span>
            </p>
            <div className="seat">
              <p className="who">User B</p>
              <p className="task">Agent working on a prompt.</p>
              <p className="eta">
                3 min
                <small>left on the task</small>
              </p>
            </div>
          </div>
          <p className="payoff">The winner gets the token credits for the prompt.</p>
        </figure>
        <dl className="define">
          <div>
            <dt>Wait</dt>
            <dd>How long each agent still needs. User A has 4 minutes. User B has 3.</dd>
          </div>
          <div>
            <dt>Battle</dt>
            <dd>Chess, flappy, or a puzzle, inside the editor, while both agents keep working.</dd>
          </div>
          <div>
            <dt>Credits</dt>
            <dd>The winner gets token credits. Those credits pay for the prompt.</dd>
          </div>
        </dl>
        <p className="closing">
          <a className="textlink" href={OVSX}>
            Open VSX
          </a>{" "}
          has the extension.{" "}
          <a className="textlink" href="/room">
            The table
          </a>{" "}
          shows who is here, and flappy is played on it.
        </p>
      </section>
    </div>
  );
}
