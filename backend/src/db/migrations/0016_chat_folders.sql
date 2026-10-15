-- Each chat keeps its files in its own workspace folder ("Chats/<title>"): what the student
-- attaches and what the agent makes there. Named once, so renaming the chat never moves it.
ALTER TABLE chats ADD COLUMN folder text;
