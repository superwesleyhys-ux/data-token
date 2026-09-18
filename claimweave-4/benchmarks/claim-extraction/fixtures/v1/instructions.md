# Claimweave offline fixture instructions

This fixture pack is synthetic, versioned, and provider-free. The source files
are the only original-source inputs. Reference annotations are authored
independently from the source extraction output and check exact spans, numeric
values, negation, qualifiers, and dates. Corroboration records are separate
independently authored facts; they are not copied from the source files and are
never used as original-source input.

The offline runner must:

1. hash every checked-in source, annotation, and corroboration file;
2. verify the manifest hashes and exact annotation spans;
3. verify that source and corroboration identifiers and content are distinct;
4. apply the six ordered cache scenarios in `manifest.json`;
5. keep permission, model, and prompt changes as separate rejection reasons;
6. report deterministic extraction/reuse decisions and zero provider calls.

No URL fetch, database access, AI proxy request, provider request, credential,
or secret is permitted in this command.
