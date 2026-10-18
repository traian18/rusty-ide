//! What to do about each kind of code health issue, in the words a fix prompt hands to an agent.
//! Keyed by detector id; an unknown detector gets general advice rather than nothing.

/// Concrete refactoring steps for issues of `detector`.
pub(super) fn how_to_fix(detector: &str) -> &'static str {
    match detector {
        "complex_method" => "Reduce the number of independent paths: move each branch body into a well-named helper, replace long if/else or match chains on a value with a lookup table or polymorphism, and return early for edge cases so the main path reads straight down.",
        "large_method" => "Split the function into steps, each a function named after what it does (parse, validate, compute, write); keep the original as a short coordinator that calls them in order. Move setup and error handling out of the main logic.",
        "brain_method" => "This function is long, complex and sits in a file many others import, so changes ripple. Split it into smaller functions behind the same signature first (callers stay untouched), then move parts that belong elsewhere into their own module.",
        "nested_complexity" => "Flatten the nesting: invert conditions and return or continue early, extract the innermost blocks into helpers, and replace nested loops with iterator chains or a separate function per level.",
        "bumpy_road" => "Each separate block of nested logic is its own task: extract every bump into a named helper so the function becomes a flat sequence of calls.",
        "complex_conditional" => "Name the condition: move the boolean expression into a well-named variable or predicate function, split it into smaller named parts, and remove double negations.",
        "primitive_obsession" => "Group parameters that travel together into a struct or type with a meaningful name, and replace raw strings or numbers that carry meaning (ids, units, modes) with dedicated types or enums.",
        "god_class" => "Split the class by responsibility: group its methods by the fields they use, move each group into its own type, and keep the original as a thin facade only if callers need it. Break up its largest method first.",
        "low_cohesion" => "The methods form unrelated groups that share no fields: move each group into its own type or module so each piece has one reason to change.",
        "churn_risk" => "The file is rewritten more than its own size recently. Find what keeps changing (configuration, a growing match, mixed concerns), separate the stable part from the volatile part, and move the volatile part behind data or a smaller module.",
        "change_entropy" => "The file mostly changes inside wide, scattered commits. Find the concern it shares with the other files in those commits and bring that concern together in one place, so a change touches fewer files.",
        "co_change_scatter" => "The file changes together with many others. Identify the shared knowledge (a format, a protocol, duplicated rules) and move it into one module the others depend on.",
        "prior_defect" => "The file has been bug-fixed repeatedly. Look at the code the fixes touched, find the fragile pattern (unchecked inputs, duplicated state, implicit ordering), make it explicit, and add tests for the cases that broke.",
        "ownership_risk" | "developer_congestion" => "Many people change this file with no clear lead. Split it so separate concerns live in separate files, and make its contract explicit with types, documentation and tests so occasional contributors change it safely.",
        "knowledge_loss" => "Its only real owner has gone quiet. Document what the file does and why (module comment, invariants), add tests that pin current behaviour, and simplify the parts that only the owner understood.",
        _ => "Refactor the code at the lines given so the measured values fall below their limits, keeping behaviour the same.",
    }
}

#[cfg(test)]
mod tests {
    use harness_code_health::registry;

    use super::how_to_fix;

    #[test]
    fn every_detector_has_specific_advice() {
        let general = how_to_fix("unknown");
        for detector in registry() {
            assert_ne!(how_to_fix(detector.id()), general, "{}", detector.id());
        }
    }
}
