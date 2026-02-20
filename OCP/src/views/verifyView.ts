import { renderViewFrame, escapeHtml, shortHash } from "./common";
import type { VerifyResponse } from "../data/types";

function checkIcon(valid: boolean | undefined): string {
  if (valid === undefined) return `<span class="check-na">—</span>`;
  return valid
    ? `<span class="check-ok">✓</span>`
    : `<span class="check-fail">✗</span>`;
}

export function renderVerifyView(result: VerifyResponse | null, error: string | null): string {
  let resultHtml = "";

  if (error) {
    resultHtml = `<div style="color:var(--danger); margin-top:1rem;">${escapeHtml(error)}</div>`;
  } else if (result) {
    resultHtml = `
      <div class="divider"></div>
      <div class="card-title">Verification Result</div>
      <table>
        <tbody>
          <tr>
            <td>Agreement Code</td>
            <td><code>${escapeHtml(result.agreementCode)}</code></td>
          </tr>
          <tr>
            <td>Terms Hash</td>
            <td><code class="hash">${escapeHtml(shortHash(result.termsHash, 24))}</code></td>
          </tr>
          <tr>
            <td>Terms hash valid</td>
            <td>${checkIcon(result.termsHashValid)}</td>
          </tr>
          <tr>
            <td>Party A signature (sigA)</td>
            <td>${checkIcon(result.sigAValid)}</td>
          </tr>
          <tr>
            <td>Party B signature (sigB)</td>
            <td>${checkIcon(result.sigBValid)}</td>
          </tr>
          <tr>
            <td><strong>Overall</strong></td>
            <td><strong>${result.overallValid ? '<span class="check-ok">VALID</span>' : '<span class="check-fail">INVALID</span>'}</strong></td>
          </tr>
          ${result.reason ? `<tr><td>Reason</td><td style="color:var(--danger)">${escapeHtml(result.reason)}</td></tr>` : ""}
        </tbody>
      </table>
    `;
  }

  return renderViewFrame({
    title: "Verify Agreement",
    subtitle: "Check all hashes and Ed25519 signatures for a sealed agreement.",
    body: `
      <div class="card">
        <div class="card-title">Look Up Agreement</div>
        <form id="ocp-verify-form">
          <div class="section-tabs">
            <button type="button" class="section-tab active" data-tab="by-id">By Proposal ID</button>
            <button type="button" class="section-tab" data-tab="by-code">By Agreement Code</button>
          </div>
          <div id="tab-by-id">
            <div class="field">
              <label>Proposal ID</label>
              <input type="text" name="proposalId" placeholder="prop_xxxx_xxxx" />
            </div>
          </div>
          <div id="tab-by-code" style="display:none;">
            <div class="field">
              <label>Agreement Code</label>
              <input type="text" name="agreementCode" placeholder="PV4DBJZ9WQ" maxlength="10" />
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Verify</button>
        </form>
        ${resultHtml}
      </div>

      <div class="card">
        <div class="card-title">What is verified?</div>
        <p style="color:var(--muted); font-size:12px; line-height:1.8;">
          The verifier recomputes the attestation payload from the stored agreement fields
          and checks that both stored Ed25519 signatures are valid over that payload.
          A passing verification proves that both registered agent identities
          mutually attested to the same canonical terms at the recorded time.
        </p>
      </div>
    `,
  });
}
