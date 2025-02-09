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
    const {workflow_id} = req.params;
    const {pipeline_id,project_slug} = req.body;

    try {
        // fetch user info
        const {data} = await axios.get("https://circleci.com/api/v2/me", {
            headers: {"Circle-Token": CIRCLECI_TOKEN},
        })

        const sanitizeName = sanitizeEmail(data?.name);
        // Step 1: Set Environment Variable to Mark API Rerun
        const env_to_set = `BROWSERSTACK_RERUN_${replaceDashesWithUnderscores(pipeline_id)}_${sanitizeName}`;
        await axios.post(
            `https://circleci.com/api/v2/project/${project_slug}/envvar`,
            {
                name: env_to_set,
                value: "true",
            },
            {headers: {"Circle-Token": CIRCLECI_TOKEN, "Content-Type": "application/json"}}
        );

        cache[`${pipeline_id}_${sanitizeName}`] = "test_add";

        // Step 2: Trigger Workflow Rerun
        await axios.post(
            `https://circleci.com/api/v2/workflow/${workflow_id}/rerun`,
            {},
            {headers: {"Circle-Token": CIRCLECI_TOKEN, "Content-Type": "application/json"}}
        );
        res.status(200).json({message: "Rerun triggered successfully."});
    } catch (error) {
        console.log(error);
        res.status(500).json({error: error.message});
    }
});

// get workflow_details from cache and delete env var
app.get("/workflow_details/:pipeline_id", async (req, res) => {
    const {pipeline_id} = req.params;
    const {name} = req.query;

    /*
    Will have to get it from db or from cache where we can store it user -> project_slug.
    We can may be store this into same cache key basically pipeline_id,user -> run_tests, project_slug
     */
    const project_slug = process.env.CIRCLECI_PROJECT_SLUG;

    const sanitizedName = sanitizeEmail(name);


    if (cache[`${pipeline_id}_${sanitizedName}`]) {
        // Delete Environment Variable
        await axios.delete(
            `https://circleci.com/api/v2/project/${project_slug}/envvar/BROWSERSTACK_RERUN_${replaceDashesWithUnderscores(pipeline_id)}_${sanitizedName}`,
            {headers: {"Circle-Token": CIRCLECI_TOKEN}});
        const tests = cache[`${pipeline_id}_${sanitizedName}`];
        delete cache[`${pipeline_id}_${sanitizedName}`];
        res.status(200).json({tests});
    } else {
        res.status(404).json({error: "Workflow details not found."});
    }
});

app.listen(3020, () => console.log("Service running on port 3020"));
