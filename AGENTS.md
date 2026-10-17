<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep cyber-terminal presentation separate from signal and order logic; visual activity must reflect real connection and execution state.
- Reference uploaded terminal imagery through Lovable Assets pointers to keep binary media out of source control.
- Prebundle terminal UI dependencies in Vite optimizeDeps so lazy route discovery does not invalidate React chunks during active preview sessions.
- Keep balance protection and demo performance calculations in browser-safe trading-session helpers with focused tests; only confirmed settlement counts as a result.
- Tag session trades with the executing account and demo status so strategy comparisons never mix accounts or real-money results.
- Dispatch paired buys without per-leg retries and coordinate companion exits only when Deriv confirms sellability; broker execution is not atomic and results must remain independently confirmed.
