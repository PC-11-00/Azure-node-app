// Dummy Node.js service to handle rerun requests
const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

const CIRCLECI_TOKEN = process.env.CIRCLECI_TOKEN;
const cache = {}; // hash(workflow_id + encrypted(pat_token)) = > rerun_tests

function replaceDashesWithUnderscores(str) {
    return str.replace(/-/g, "_");
}

function sanitizeEmail(email) {
    return email.replace(/[^a-zA-Z0-9]/g, '_');
}

app.post("/rerun/:workflow_id", async (req, res) => {
    const { workflow_id } = req.params;
    const { pipeline_id, project_slug, workflow_name } = req.body;
    // we could retrieve workflow_name using workflow_id
    try {
        // Fetch user info
        const { data } = await axios.get("https://circleci.com/api/v2/me", {
            headers: { "Circle-Token": CIRCLECI_TOKEN },
        });

        // as special chars are not allowed in env var names
        const sanitizedName = sanitizeEmail(data?.name);
        const sanitizedWorkflowName = replaceDashesWithUnderscores(workflow_name);
        const sanitizedPipelineId = replaceDashesWithUnderscores(pipeline_id);

        // Step 1: Set Environment Variable to Mark API Rerun
        const env_to_set = `BROWSERSTACK_RERUN_${sanitizedPipelineId}_${sanitizedName}_${sanitizedWorkflowName}`;
        await axios.post(
            `https://circleci.com/api/v2/project/${project_slug}/envvar`,
            {
                name: env_to_set,
                value: "true",
            },
            { headers: { "Circle-Token": CIRCLECI_TOKEN, "Content-Type": "application/json" } }
        );

        // Store the rerun details in cache
        cache[`${sanitizedPipelineId}_${sanitizedName}_${sanitizedWorkflowName}`] = "test_add";

        // Step 2: Trigger Workflow Rerun
        await axios.post(
            `https://circleci.com/api/v2/workflow/${workflow_id}/rerun`,
            {},
            { headers: { "Circle-Token": CIRCLECI_TOKEN, "Content-Type": "application/json" } }
        );

        res.status(200).json({ message: "Rerun triggered successfully." });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/workflow_details/:pipeline_id", async (req, res) => {
    const { pipeline_id } = req.params;
    const { name, workflow_id } = req.query;  // Accept workflow_id as a query param

    const project_slug = process.env.CIRCLECI_PROJECT_SLUG;
    const sanitizedName = sanitizeEmail(name);

    try {
        // Fetch workflow details using workflow_id
        const { data: workflowData } = await axios.get(
            `https://circleci.com/api/v2/workflow/${workflow_id}`,
            { headers: { "Circle-Token": CIRCLECI_TOKEN } }
        );

        const workflow_name = workflowData?.name;
        if (!workflow_name) {
            return res.status(404).json({ error: "Workflow name not found." });
        }

        const sanitizedWorkflowName = replaceDashesWithUnderscores(workflow_name);
        const cacheKey = `${pipeline_id}_${sanitizedName}_${sanitizedWorkflowName}`;

        if (cache[cacheKey]) {
            // Delete Environment Variable
            const env_to_delete = `BROWSERSTACK_RERUN_${replaceDashesWithUnderscores(pipeline_id)}_${sanitizedName}_${sanitizedWorkflowName}`;
            await axios.delete(
                `https://circleci.com/api/v2/project/${project_slug}/envvar/${env_to_delete}`,
                { headers: { "Circle-Token": CIRCLECI_TOKEN } }
            );

            // Retrieve and delete the cache
            const tests = cache[cacheKey];
            delete cache[cacheKey];

            return res.status(200).json({ tests });
        }

        res.status(404).json({ error: "Workflow details not found in cache." });
    } catch (error) {
        console.error("Error fetching workflow details:", error);
        res.status(500).json({ error: "Failed to fetch workflow details" });
    }
});


app.listen(3020, () => console.log("Service running on port 3020"));
