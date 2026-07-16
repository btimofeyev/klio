import type { DynamicPracticeSpec } from "@/lib/practice/spec";

export type GroundedPracticeContext = {
  subject: string;
  skillKey: string;
  levelBand: string | null;
  assignmentDirections: string | null;
  reviewFeedback: string[];
  evidenceExcerpts: string[];
  priorPracticeNotes: string[];
  parentCorrections: string[];
  curriculumPosition: string | null;
};

export function buildTargetedPractice(input: GroundedPracticeContext): DynamicPracticeSpec | null {
  const subject = input.subject.trim();
  const context = [
    input.assignmentDirections,
    ...input.reviewFeedback,
    ...input.evidenceExcerpts,
    ...input.priorPracticeNotes,
    ...input.parentCorrections,
    input.curriculumPosition,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (!context) return null;
  if (/osmosis/i.test(`${input.skillKey} ${context}`) && /water|concentration|hypertonic|hypotonic/i.test(context)) {
    return osmosisPractice(subject, input.skillKey, input.levelBand, context);
  }
  if (/claim|evidence|reasoning|commentary|support.*detail/i.test(context)) {
    return groundedExplanationPractice(subject, input.skillKey, input.levelBand, context);
  }
  const equation = firstLinearEquation(context);
  if (/math|algebra/i.test(subject) && equation) return equationPractice(subject, input.skillKey, input.levelBand, context, equation);
  return null;
}

function osmosisPractice(subject: string, skillKey: string, levelBand: string | null, context: string): DynamicPracticeSpec {
  return {
    version: 2, subject, skill_key: skillKey, level_band: levelBand ?? "Not specified", mastery_percent: 80,
    instructions: `Use the assignment’s concentration-and-water-movement explanation as your anchor. Source context: ${context.slice(0, 500)}`,
    activities: [
      { id: "direction", type: "multiple_choice", prompt: "A cell has more dissolved solute outside than inside. Which way does water move?", choices: ["Out of the cell", "Into the cell", "Water does not move"], correct_answer: "Out of the cell", hints: ["Compare solute concentration on both sides."], explanation: "Water moves across the membrane toward the side with the greater solute concentration." },
      { id: "definition", type: "short_answer", prompt: "Osmosis is the movement of which substance across a selectively permeable membrane?", accepted_answers: ["water", "water molecules"], hints: ["Name the solvent."], explanation: "Osmosis specifically describes water movement." },
      { id: "hypotonic", type: "short_answer", prompt: "If the solution outside a cell is hypotonic, does water move into or out of the cell?", accepted_answers: ["into", "into the cell", "in"], hints: ["Hypotonic means lower solute concentration outside."], explanation: "Water moves into the cell toward the higher solute concentration." },
      { id: "hypertonic", type: "multiple_choice", prompt: "A cell shrinks after it is placed in a solution. Which description best fits the solution outside the cell?", choices: ["Hypertonic", "Hypotonic", "Equal water and solute movement"], correct_answer: "Hypertonic", hints: ["A shrinking cell has lost water."], explanation: "A hypertonic solution has the greater solute concentration, so water leaves the cell." },
      { id: "sequence", type: "short_answer", prompt: "Complete the sequence: higher solute concentration → water moves toward it → the cell loses water and ____.", accepted_answers: ["shrinks", "gets smaller", "decreases in size"], hints: ["Describe the cell’s size."], explanation: "When water leaves, the cell shrinks." },
      { id: "scenario", type: "written_response", prompt: "Explain why a plant cell becomes firm in fresh water. Connect concentration, water movement, and the cell wall.", success_criteria: ["States that water moves into the cell", "Connects movement to concentration", "Mentions the cell wall or turgor pressure"], hints: ["Trace the water, then say what resists expansion."], explanation: "Water enters by osmosis; the wall resists expansion and turgor pressure makes the cell firm.", max_length: 700 },
    ],
  };
}

function groundedExplanationPractice(subject: string, skillKey: string, levelBand: string | null, context: string): DynamicPracticeSpec {
  const excerpt = context.slice(0, 420);
  return {
    version: 2, subject, skill_key: skillKey, level_band: levelBand ?? "Not specified", mastery_percent: 80,
    instructions: `Revise the explanation gap identified in the reviewed work. Source context: ${excerpt}`,
    activities: [
      { id: "identify", type: "multiple_choice", prompt: "Which revision most clearly connects a specific detail to a claim?", choices: ["Name the detail and explain why it supports the claim", "Repeat the claim", "Add an unrelated fact"], correct_answer: "Name the detail and explain why it supports the claim", hints: ["Look for a reasoning link."], explanation: "Evidence becomes useful when the response explains how it supports the claim." },
      { id: "connection", type: "short_answer", prompt: "Name one phrase that can introduce the reasoning connection after evidence.", accepted_answers: ["this shows", "this demonstrates", "this supports the claim because", "therefore"], hints: ["Try a phrase beginning with “This…”"], explanation: "A transition such as “This shows” signals the reasoning step." },
      { id: "specificity", type: "multiple_choice", prompt: "Which evidence sentence is more useful in an explanation?", choices: ["A sentence naming the exact detail from the source", "A sentence saying only that the source is interesting", "A sentence about a different topic"], correct_answer: "A sentence naming the exact detail from the source", hints: ["Choose the sentence a reader could verify."], explanation: "Specific, verifiable details give the explanation something concrete to reason from." },
      { id: "reasoning-check", type: "short_answer", prompt: "After writing evidence, what question should you answer to add reasoning?", accepted_answers: ["how does this support the claim", "why does this support the claim", "what does this show", "how does the evidence prove the claim"], hints: ["Ask how or why the detail matters."], explanation: "Reasoning explains how or why the evidence supports the claim." },
      { id: "revise", type: "written_response", prompt: "Using the same topic as the submitted work, write two sentences: one with a specific supporting detail and one explaining how it supports the claim.", success_criteria: ["Uses the submitted topic", "Includes a specific detail", "Explains the connection to the claim"], hints: ["Do not introduce a new topic."], explanation: "The second sentence should make the evidence-to-claim connection explicit.", max_length: 800 },
      { id: "self-check", type: "written_response", prompt: "Read your two sentences and name one word or phrase that makes the evidence-to-claim connection clear.", success_criteria: ["Names a phrase from the response", "Explains the phrase’s job"], hints: ["Look for words such as because, therefore, or this shows."], explanation: "A visible reasoning phrase helps the reader follow the connection.", max_length: 400 },
    ],
  };
}

function equationPractice(subject: string, skillKey: string, levelBand: string | null, context: string, equation: { text: string; answer: string; coefficient: number; isolatedRight: string; firstMove: string }) : DynamicPracticeSpec {
  return {
    version: 2, subject, skill_key: skillKey, level_band: levelBand ?? "Not specified", mastery_percent: 80,
    instructions: `Work from the exact equation found in the reviewed evidence. Source context: ${context.slice(0, 500)}`,
    activities: [
      { id: "source-equation", type: "short_answer", prompt: `Solve the source equation: ${equation.text}`, accepted_answers: [equation.answer, `x=${equation.answer}`, `x = ${equation.answer}`], hints: ["Use inverse operations and preserve equality."], explanation: `Solving the source equation gives x = ${equation.answer}.` },
      { id: "first-move", type: "multiple_choice", prompt: `What is the most useful first inverse operation for ${equation.text}?`, choices: [equation.firstMove, "Multiply both sides by 0", "Change only the left side"], correct_answer: equation.firstMove, hints: ["Undo the constant term while keeping both sides equal."], explanation: `${equation.firstMove} isolates the variable term without breaking equality.` },
      { id: "variable-term", type: "short_answer", prompt: `After undoing the constant in ${equation.text}, what value remains on the other side of the variable term?`, accepted_answers: [equation.isolatedRight, `${equation.isolatedRight}`], hints: [equation.firstMove], explanation: `Undoing the constant leaves ${equation.coefficient}x = ${equation.isolatedRight}.` },
      { id: "check", type: "written_response", prompt: `Substitute x = ${equation.answer} into ${equation.text} and explain how the check confirms the solution.`, success_criteria: ["Substitutes the value", "Shows both sides are equal"], hints: ["Evaluate the left and right sides separately."], explanation: "A value is a solution when substitution makes both sides equal.", max_length: 500 },
      { id: "balance", type: "multiple_choice", prompt: "Why must the same inverse operation be applied to both sides of an equation?", choices: ["To keep the two sides equal", "To make the numbers larger", "To change the variable’s name"], correct_answer: "To keep the two sides equal", hints: ["Think of an equation as a balance."], explanation: "Applying the same operation to both sides preserves equality." },
      { id: "explain", type: "written_response", prompt: `Explain the two main moves that solve ${equation.text}, and name the check you would use at the end.`, success_criteria: ["Describes undoing the constant", "Describes isolating x", "Mentions substitution"], hints: ["Describe the moves in order."], explanation: "A complete solution isolates the variable with inverse operations and verifies it by substitution.", max_length: 600 },
    ],
  };
}

function firstLinearEquation(context: string) {
  const match = context.match(/(-?\d+)\s*x\s*([+-])\s*(\d+)\s*=\s*(-?\d+)/i);
  if (!match) return null;
  const coefficient = Number(match[1]);
  const constant = Number(match[3]) * (match[2] === "-" ? -1 : 1);
  const right = Number(match[4]);
  if (!coefficient) return null;
  const answer = (right - constant) / coefficient;
  if (!Number.isFinite(answer)) return null;
  const isolatedRight = right - constant;
  return {
    text: match[0], coefficient,
    answer: Number.isInteger(answer) ? String(answer) : String(Math.round(answer * 100) / 100),
    isolatedRight: Number.isInteger(isolatedRight) ? String(isolatedRight) : String(Math.round(isolatedRight * 100) / 100),
    firstMove: constant >= 0 ? `Subtract ${Math.abs(constant)} from both sides` : `Add ${Math.abs(constant)} to both sides`,
  };
}
